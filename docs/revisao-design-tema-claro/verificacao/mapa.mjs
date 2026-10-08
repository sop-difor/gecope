// B4: capturas do Mapa (Contratos embutido): Distritos, um distrito, ficha da obra; mede texto < 12px.
// Env: GC_USER, GC_PASS, GC_OUT.
export default async function run(page, ui) {
  const base = process.env.GC_OUT, user = process.env.GC_USER, pass = process.env.GC_PASS;
  const res = {};
  await page.setViewportSize({width:1440,height:900});
  for (const theme of ['light','dark']) {
    await page.evaluate(function(t){ localStorage.setItem('gecope_theme', t); }, theme);
    await page.reload(); await page.waitForTimeout(2500);
    if (await page.locator('#landing-matricula').isVisible()) {
      await page.fill('#landing-matricula', user); await page.fill('#landing-password', pass);
      await page.keyboard.press('Enter'); await page.waitForTimeout(7000);
    }
    await page.locator('.home-action-card, .home-list-row').filter({hasText:'Contratos'}).first().click();
    await page.waitForTimeout(10000);
    const fr = page.frames().find(f => /mapa_obras/.test(f.url()));
    if (!fr) { res[theme]='sem frame'; continue; }
    await page.screenshot({path: base+'/'+theme+'-mapa-1-distritos.png', animations:'disabled'});
    res[theme+'-pequenos'] = await fr.evaluate(function(){
      var bad={}, w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), t;
      while(t=w.nextNode()){ var s=t.nodeValue.trim(); if(!s||s.length<4) continue; var el=t.parentElement; var cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') continue; var r=el.getBoundingClientRect(); if(r.width<2||r.height<2) continue; var fs=parseFloat(cs.fontSize); if(fs<11.99){ var k=el.tagName.toLowerCase()+'.'+String(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className).split(' ')[0]+' '+fs.toFixed(1); bad[k]=(bad[k]||0)+1; } }
      var fams={}; document.querySelectorAll('*').forEach(function(e){ var f=getComputedStyle(e).fontFamily.split(',')[0]; fams[f]=(fams[f]||0)+1; });
      return {pequenos:bad, familias:fams};
    });
    // abre o distrito Crato pelo rótulo
    try {
      await fr.locator('.grp-label').filter({hasText:'Crato'}).first().click({timeout:4000, force:true});
      await page.waitForTimeout(3000);
      await page.screenshot({path: base+'/'+theme+'-mapa-2-distrito.png', animations:'disabled'});
    } catch(e) { res[theme+'-distrito']='erro '+String(e).slice(0,60); }
    await page.locator('.gc-trilha-voltar').first().click(); await page.waitForTimeout(800);
  }
  return res;
}
