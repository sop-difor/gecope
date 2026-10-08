// B5: texto < 12px, caixa alta por CSS e famílias de fonte nos módulos embutidos (Atividades e Assistente).
// Env: GC_USER, GC_PASS, GC_OUT. Mede no frame do módulo e salva uma captura de cada tema.
export default async function run(page, ui) {
  const base = process.env.GC_OUT, user = process.env.GC_USER, pass = process.env.GC_PASS, res = {};
  await page.setViewportSize({width:1440,height:900});
  const alvos = [['Atividades', /cronograma/], ['Assistente de Dados', /assistente/]];
  for (const theme of ['light','dark']) {
    await page.evaluate(function(t){ localStorage.setItem('gecope_theme', t); }, theme);
    await page.reload(); await page.waitForTimeout(2500);
    if (await page.locator('#landing-matricula').isVisible()) {
      await page.fill('#landing-matricula', user); await page.fill('#landing-password', pass);
      await page.keyboard.press('Enter'); await page.waitForTimeout(7000);
    }
    for (const [nome, re] of alvos) {
      const back = page.locator('.gc-trilha-voltar').first();
      if (await back.isVisible()) { await back.click(); await page.waitForTimeout(700); }
      await page.locator('.home-action-card, .home-list-row').filter({hasText:nome}).first().click();
      await page.waitForTimeout(10000);
      const fr = page.frames().find(f => re.test(f.url()) && !/painel/.test(f.url()));
      if (!fr) { res[theme+' '+nome]='sem frame'; continue; }
      await page.screenshot({path: base+'/'+theme+'-'+nome.replace(/\s+/g,'_')+'.png', animations:'disabled'});
      res[theme+' '+nome] = await fr.evaluate(function(){
        var small={}, upper={}, fams={}, w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), t, tot=0;
        function cls(el){ var c=(typeof el.className==='string'?el.className:'').trim().split(/\s+/)[0]; return el.tagName.toLowerCase()+(c?'.'+c:''); }
        while(t=w.nextNode()){ var s=t.nodeValue.trim(); if(!s) continue; var el=t.parentElement; var cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') continue; var r=el.getBoundingClientRect(); if(r.width<2||r.height<2) continue; tot++;
          var f=cs.fontFamily.split(',')[0].replace(/"/g,''); fams[f]=(fams[f]||0)+1;
          var fs=parseFloat(cs.fontSize); if(fs<11.99 && s.length>3){ var k=cls(el)+' '+fs.toFixed(1); small[k]=(small[k]||0)+1; }
          if(cs.textTransform==='uppercase' && s.length>3){ var k2=cls(el)+' «'+s.slice(0,18)+'»'; upper[k2]=(upper[k2]||0)+1; } }
        return {textos:tot, pequenos:small, caixaAlta:Object.keys(upper).slice(0,14), familias:fams};
      });
    }
  }
  return res;
}
