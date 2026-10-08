export default async function run(page, ui) {
  const user = process.env.GC_USER, pass = process.env.GC_PASS;
  const mods = ['Processos','Financeiro','Curva ABC','Orçamentos','Composições','Tabelas','Administração'];
  const out = {};
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(function(){ localStorage.setItem('gecope_theme','light'); });
  await page.reload(); await page.waitForTimeout(2500);
  await page.fill('#landing-matricula', user); await page.fill('#landing-password', pass);
  await page.keyboard.press('Enter'); await page.waitForTimeout(7000);
  const scan = function(){
    function parse(c){ var m=c.match(/rgba?\(([^)]+)\)/); if(!m) return null; var p=m[1].split(',').map(function(x){return parseFloat(x)}); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
    function lum(c){ var a=[c.r,c.g,c.b].map(function(v){v/=255; return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)}); return .2126*a[0]+.7152*a[1]+.0722*a[2]; }
    function over(f,b){ var a=f.a; return {r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1}; }
    function bgOf(el){ var stack=[]; var n=el; while(n&&n.nodeType===1){ var cs=getComputedStyle(n); if(cs.backgroundImage!=='none') return null; var c=parse(cs.backgroundColor); if(c&&c.a>0){ stack.push(c); if(c.a>=1) break; } n=n.parentElement; }
      var base={r:255,g:255,b:255,a:1}; if(stack.length&&stack[stack.length-1].a>=1) base=stack.pop(); while(stack.length) base=over(stack.pop(),base); return base; }
    var seen={}, fails=[], total=0;
    var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    var t; while(t=w.nextNode()){
      if(!t.nodeValue.trim()) continue; var el=t.parentElement; if(!el) continue;
      if(!el.closest('.tab-pane.active, .modal.show')) continue;
      var cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0) continue;
      var r=el.getBoundingClientRect(); if(r.width<2||r.height<2) continue;
      var fg=parse(cs.color); var bg=bgOf(el); if(!fg||!bg) continue;
      var op=1, n=el; while(n&&n.nodeType===1){ op*=parseFloat(getComputedStyle(n).opacity); n=n.parentElement; }
      fg=over({r:fg.r,g:fg.g,b:fg.b,a:fg.a*op},bg);
      var L1=lum(fg),L2=lum(bg); var ratio=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
      var size=parseFloat(cs.fontSize), bold=parseInt(cs.fontWeight)>=700; var large=size>=24||(size>=18.66&&bold);
      total++; if(ratio < (large?3:4.5)){ var key=(el.className||el.tagName)+'|'+cs.color+'|'+ratio.toFixed(2); if(!seen[key]){ seen[key]=1; fails.push({cls:String(el.className||el.tagName).slice(0,50),txt:t.nodeValue.trim().slice(0,28),ratio:+ratio.toFixed(2),size:size}); } }
    }
    return {total:total, falhas:fails.length, exemplos:fails.slice(0,6)};
  };
  for (const m of mods) {
    try {
      const back = page.locator('.gc-trilha-voltar').first();
      if (await back.count()) { try { await back.click({timeout:1500}); } catch(e){} }
      await page.waitForTimeout(700);
      const card = page.locator('.home-action-card, .home-list-row').filter({hasText: m}).first();
      await card.scrollIntoViewIfNeeded(); await card.click({timeout:4000});
      await page.waitForTimeout(4500);
      out[m] = await page.evaluate(scan);
    } catch(e){ out[m]='erro ' + String(e).slice(0,60); }
  }
  return out;
}
