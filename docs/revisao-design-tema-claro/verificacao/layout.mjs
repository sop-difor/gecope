// B3: margem lateral e rolagem horizontal por módulo e largura; cabeçalho da janela "Gerenciar processo".
// Env: GC_USER, GC_PASS, GC_OUT (pasta das capturas).
export default async function run(page, ui) {
  const base = process.env.GC_OUT, user = process.env.GC_USER, pass = process.env.GC_PASS;
  const mods = ['Processos','Financeiro','Curva ABC','Orçamentos','Composições','Tabelas','Administração'];
  const res = {};
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(function(){ localStorage.setItem('gecope_theme','light'); });
  await page.reload(); await page.waitForTimeout(2500);
  await page.fill('#landing-matricula', user); await page.fill('#landing-password', pass);
  await page.keyboard.press('Enter'); await page.waitForTimeout(7000);
  for (const w of [1280,1440,1920]) {
    await page.setViewportSize({width:w,height:900});
    for (const m of mods) {
      try {
        const back = page.locator('.gc-trilha-voltar').first();
        if (await back.isVisible()) await back.click({timeout:1500});
        await page.waitForTimeout(500);
        await page.locator('.home-action-card, .home-list-row').filter({hasText: m}).first().click({timeout:4000});
        await page.waitForTimeout(3500);
        res[w+' '+m] = await page.evaluate(function(){
          var pane=document.querySelector('.tab-pane.active.show')||document.querySelector('.tab-pane.active');
          var d=document.documentElement;
          var xs=[]; pane.querySelectorAll('section,.proc-kpi-grid,.filters-card,.gc-page-head,.accordion,.table-responsive,.budget-hero-card,.fin-section-heading,.proc-table-card,table').forEach(function(e){
            var r=e.getBoundingClientRect(); if(r.width>200&&r.height>10) xs.push(Math.round(r.left)+'-'+Math.round(r.right)); });
          var u=Array.from(new Set(xs));
          var main=document.querySelector('main.page-wrapper').getBoundingClientRect();
          return {rolagemH: d.scrollWidth>d.clientWidth, sobra: d.scrollWidth-d.clientWidth, main: Math.round(main.left)+'-'+Math.round(main.right), blocos: u.slice(0,8).join(' ')};
        });
      } catch(e) { res[w+' '+m]='erro '+String(e).slice(0,60); }
    }
  }
  // janela
  await page.setViewportSize({width:1440,height:900});
  try {
    const back = page.locator('.gc-trilha-voltar').first(); if (await back.isVisible()) await back.click();
    await page.waitForTimeout(500);
    await page.locator('.home-action-card').filter({hasText:'Processos'}).first().click(); await page.waitForTimeout(4500);
    await page.locator('#pane-reuniao [class*="bi-eye"]:visible').first().click({timeout:6000, force:true});
    await page.waitForTimeout(3500);
    await page.screenshot({path: base + '/modal-proc.png', animations:'disabled'});
    res.modalHeader = await page.evaluate(function(){ var h=document.querySelector('.modal.show .modal-header'); var c=getComputedStyle(h); return c.backgroundColor+' '+h.className; });
  } catch(e){ res.modal='erro '+String(e).slice(0,80); }
  return res;
}
