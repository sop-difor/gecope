export default async function run(page, ui) {
  const base = process.env.GC_OUT;           // pasta de saída
  const user = process.env.GC_USER, pass = process.env.GC_PASS;
  const mods = ['Processos','Financeiro','Curva ABC','Orçamentos','Composições','Tabelas','Contratos','Atividades','Assistente de Dados','Administração'];
  const res = {};
  await page.setViewportSize({width:1440,height:900});
  for (const theme of ['light','dark']) {
    await page.evaluate(function(t){ localStorage.setItem('gecope_theme', t); }, theme);
    await page.reload();
    await page.waitForTimeout(2500);
    if (await page.locator('#landing-matricula').isVisible()) {
      await page.fill('#landing-matricula', user);
      await page.fill('#landing-password', pass);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(7000);
    }
    await page.screenshot({path: base + '/' + theme + '-00-home.png', animations:'disabled'});
    for (let i=0;i<mods.length;i++){
      const m = mods[i];
      try {
        const back = page.locator('.gc-trilha-voltar').first();
        if (await back.count()) { try { await back.click({timeout:1500}); } catch(e){} }
        await page.waitForTimeout(700);
        const card = page.locator('.home-action-card, .home-list-row').filter({hasText: m}).first();
        await card.scrollIntoViewIfNeeded();
        await card.click({timeout:4000});
        await page.waitForTimeout(['Contratos','Atividades','Assistente de Dados'].includes(m) ? 9000 : 4500);
        await page.screenshot({path: base + '/' + theme + '-' + String(i+1).padStart(2,'0') + '-' + m.replace(/\s+/g,'_') + '.png', animations:'disabled'});
        res[theme+':'+m]='ok';
      } catch(e) { res[theme+':'+m]='erro ' + String(e).slice(0,60); }
    }
  }
  return res;
}
