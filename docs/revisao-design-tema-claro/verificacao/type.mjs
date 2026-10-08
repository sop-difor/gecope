export default async function run(page, ui) {
  const user = process.env.GC_USER, pass = process.env.GC_PASS;
  const mods = ['__home__','Processos','Financeiro','Curva ABC','Orçamentos','Composições','Tabelas','Administração'];
  const out = {};
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(function(){ localStorage.setItem('gecope_theme','light'); });
  await page.reload(); await page.waitForTimeout(2500);
  await page.fill('#landing-matricula', user); await page.fill('#landing-password', pass);
  await page.keyboard.press('Enter'); await page.waitForTimeout(7000);
  const scan = function(){
    var small={}, upper={}, caps={}, just={}, tot=0;
    function cls(el){ var c=(typeof el.className==='string'?el.className:'').trim().split(/\s+/).slice(0,2).join('.'); return el.tagName.toLowerCase()+(c?'.'+c:''); }
    var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT), t;
    while(t=w.nextNode()){
      var s=t.nodeValue.trim(); if(!s) continue; var el=t.parentElement; if(!el) continue;
      if(!el.closest('.tab-pane.active, .modal.show')) continue;
      var cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') continue;
      var r=el.getBoundingClientRect(); if(r.width<2||r.height<2) continue;
      tot++;
      var fs=parseFloat(cs.fontSize);
      if(fs<11.99 && s.length>3){ var k=cls(el)+' '+fs.toFixed(1); small[k]=small[k]||{n:0,ex:s.slice(0,22)}; small[k].n++; }
      if(cs.textTransform==='uppercase'){ var k2=cls(el); upper[k2]=upper[k2]||{n:0,ex:s.slice(0,22)}; upper[k2].n++; }
      else if(s.length>=6 && s===s.toUpperCase() && /[A-ZÀ-Ú]{4}/.test(s) && !/\d{3}/.test(s)){ var k3=cls(el); caps[k3]=caps[k3]||{n:0,ex:s.slice(0,26)}; caps[k3].n++; }
      if(cs.textAlign==='justify'){ var k4=cls(el); just[k4]=just[k4]||{n:0,ex:s.slice(0,22)}; just[k4].n++; }
    }
    function top(o,n){ return Object.keys(o).sort(function(a,b){return o[b].n-o[a].n}).slice(0,n).map(function(k){return k+' ×'+o[k].n+' «'+o[k].ex+'»'}); }
    return {textos:tot, pequenos:Object.keys(small).length, pequenosTop:top(small,6), uppercaseCSS:Object.keys(upper).length, uppercaseTop:top(upper,8), capsDigitadas:top(caps,6), justificados:top(just,3)};
  };
  for (const m of mods) {
    try {
      const back = page.locator('.gc-trilha-voltar').first();
      if (await back.count()) { try { await back.click({timeout:1500}); } catch(e){} }
      await page.waitForTimeout(700);
      if (m !== '__home__') {
        const card = page.locator('.home-action-card, .home-list-row').filter({hasText: m}).first();
        await card.scrollIntoViewIfNeeded(); await card.click({timeout:4000});
        await page.waitForTimeout(4500);
      }
      out[m] = await page.evaluate(scan);
    } catch(e){ out[m]='erro ' + String(e).slice(0,60); }
  }
  return out;
}
