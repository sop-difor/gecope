export default async function run(page, ui) {
  const out = await page.evaluate(function(){
    var cs = getComputedStyle(document.documentElement), names = {};
    // coleta todos os nomes de custom property declarados em folhas de estilo da mesma origem e inline
    Array.from(document.styleSheets).forEach(function(sh){
      var rules; try { rules = sh.cssRules; } catch(e){ return; }
      Array.from(rules||[]).forEach(function(r){ if (r.style) for (var i=0;i<r.style.length;i++){ var n=r.style[i]; if (n.indexOf('--')===0 && n.indexOf('--bs-')!==0) names[n]=1; } });
    });
    var res = {};
    Object.keys(names).sort().forEach(function(n){ res[n] = cs.getPropertyValue(n).trim(); });
    return res;
  });
  return out;
}
