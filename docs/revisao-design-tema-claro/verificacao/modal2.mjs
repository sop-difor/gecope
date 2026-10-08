export default async function run(page, ui) {
  const base = process.env.GC_OUT, user = process.env.GC_USER, pass = process.env.GC_PASS;
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(function(){ localStorage.setItem('gecope_theme','light'); });
  await page.reload(); await page.waitForTimeout(2500);
  await page.fill('#landing-matricula', user); await page.fill('#landing-password', pass);
  await page.keyboard.press('Enter'); await page.waitForTimeout(7000);
  await page.locator('.home-action-card').filter({hasText:'Processos'}).first().click();
  await page.waitForTimeout(5000);
  await page.locator('#pane-reuniao [class*="bi-eye"]:visible').first().click({timeout:6000, force:true});
  await page.waitForTimeout(3500);
  await page.screenshot({path: base + '/modal-proc.png', animations:'disabled'});
  return await page.evaluate(function(){
    var small={}, upper={}, caps={};
    function cls(el){ var c=(typeof el.className==='string'?el.className:'').trim().split(/\s+/).slice(0,2).join('.'); return el.tagName.toLowerCase()+(c?'.'+c:''); }
    var w=document.createTreeWalker(document.querySelector('.modal.show')||document.body,NodeFilter.SHOW_TEXT), t, tot=0;
    while(t=w.nextNode()){ var s=t.nodeValue.trim(); if(!s) continue; var el=t.parentElement; var cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') continue; var r=el.getBoundingClientRect(); if(r.width<2) continue; tot++;
      var fs=parseFloat(cs.fontSize); if(fs<11.99&&s.length>3){ var k=cls(el)+' '+fs.toFixed(1); small[k]=(small[k]||0)+1; }
      if(cs.textTransform==='uppercase'){ var k2=cls(el)+' «'+s.slice(0,20)+'»'; upper[k2]=(upper[k2]||0)+1; }
      else if(s.length>=6 && s===s.toUpperCase() && /[A-ZÀ-Ú]{4}/.test(s) && !/\d{3}/.test(s)){ var k3=cls(el)+' «'+s.slice(0,24)+'»'; caps[k3]=(caps[k3]||0)+1; } }
    return {textos:tot, pequenos:small, caixaAltaCSS:Object.keys(upper).slice(0,10), digitadasEmCaps:Object.keys(caps).slice(0,10)};
  });
}
