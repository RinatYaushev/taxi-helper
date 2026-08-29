// Клієнтський JS звіту (вбудовується в HTML як є).
//
// ⚠️ Це рядок усередині TS-шаблону: зворотні слеші треба подвоювати
// (`\\s` тут → `\s` у браузері).
export const CLIENT_JS = `
var curRec="all";
function applyFilters(){
  var q=(document.getElementById("search").value||"").trim().toLowerCase();
  document.querySelectorAll("#trips tbody tr").forEach(function(tr){
    var okRec=(curRec==="all"||tr.dataset.rec===curRec);
    var okQ=!q||tr.innerText.toLowerCase().indexOf(q)>-1;
    tr.style.display=(okRec&&okQ)?"":"none";
  });
}
document.querySelectorAll(".fbtn[data-f]").forEach(function(b){
  b.addEventListener("click",function(){
    document.querySelectorAll(".fbtn[data-f]").forEach(function(x){x.classList.remove("active")});
    b.classList.add("active");
    curRec=b.dataset.f;
    applyFilters();
  });
});
document.getElementById("search").addEventListener("input",applyFilters);
function downloadCSV(){
  var head=[].slice.call(document.querySelectorAll("#trips thead th"))
    .map(function(th){return th.textContent.replace(/[▲▼]/g,"").trim();});
  var lines=[head.join(";")];
  document.querySelectorAll("#trips tbody tr").forEach(function(tr){
    if(tr.style.display==="none")return;
    var cells=[].slice.call(tr.children).map(function(td){
      var t=td.innerText.replace(/\\s+/g," ").trim();
      return /[;"\\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;
    });
    lines.push(cells.join(";"));
  });
  var blob=new Blob(["\\ufeff"+lines.join("\\n")],{type:"text/csv;charset=utf-8"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="trips.csv"; a.click();
  URL.revokeObjectURL(a.href);
}
function downloadPDF(){ window.print(); }
(function(){
  var btn=document.getElementById("dlBtn"), menu=document.getElementById("dlMenu");
  function close(){menu.classList.remove("open");btn.setAttribute("aria-expanded","false");}
  btn.addEventListener("click",function(e){
    e.stopPropagation();
    var open=menu.classList.toggle("open");
    btn.setAttribute("aria-expanded",open?"true":"false");
  });
  menu.querySelectorAll("[data-dl]").forEach(function(item){
    item.addEventListener("click",function(){
      if(item.dataset.dl==="csv")downloadCSV(); else downloadPDF();
      close();
    });
  });
  document.addEventListener("click",close);
  document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});
})();
document.querySelectorAll("#trips thead th").forEach(function(th){
  th.addEventListener("click",function(){
    var tb=document.querySelector("#trips tbody");
    var idx=+th.dataset.col, num=th.dataset.num==="1";
    var dir=th.dataset.dir==="asc"?-1:1; th.dataset.dir=dir===1?"asc":"desc";
    document.querySelectorAll("#trips thead th .arrow").forEach(function(a){a.textContent=""});
    th.querySelector(".arrow").textContent=dir===1?"▲":"▼";
    var rows=[].slice.call(tb.querySelectorAll("tr"));
    rows.sort(function(a,b){
      var x=a.children[idx].innerText.trim(), y=b.children[idx].innerText.trim();
      if(num){return (parseFloat(x.replace(/\\s/g,"").replace("—","NaN"))-parseFloat(y.replace(/\\s/g,"").replace("—","NaN")))*dir;}
      return x.localeCompare(y,"uk")*dir;
    });
    rows.forEach(function(r){tb.appendChild(r)});
  });
});
// --- Прев'ю слота на історії: які поїздки він узяв би / відсік ---
(function(){
  var slots=window.__SLOTS__||[];
  var byId={}; slots.forEach(function(s){byId[s.id]=s;});
  // Точна семантика slotPass із src/lib.ts — тримати синхронно.
  function jsPass(s,tr){
    var amount=+tr.dataset.amount, dist=+tr.dataset.dist,
        zone=tr.dataset.zone, pickup=tr.dataset.pickup;
    if(tr.dataset.longhaul==="1")return false;
    if(pickup!=null&&pickup!==""&&(+pickup)>s.max_pickup_km)return false;
    if(zone!=="Місто"&&(s.city_only||s.price_km_suburb==null))return false;
    if(amount<s.min_order)return false;
    var p=(zone==="Місто")?s.price_km:s.price_km_suburb;
    return amount>=p*Math.max(dist,s.km_in_min);
  }
  var active=null;
  function clearPreview(){
    document.querySelectorAll("#trips tbody tr").forEach(function(tr){
      tr.classList.remove("slot-pass","slot-cut");});
    document.querySelectorAll(".fx-preview").forEach(function(b){b.classList.remove("active");});
    active=null;
  }
  document.querySelectorAll(".fx-preview").forEach(function(btn){
    btn.addEventListener("click",function(){
      var id=btn.dataset.slot, s=byId[id];
      if(active===id||!s){clearPreview();return;}
      clearPreview(); active=id; btn.classList.add("active");
      document.querySelectorAll("#trips tbody tr").forEach(function(tr){
        tr.classList.add(jsPass(s,tr)?"slot-pass":"slot-cut");});
      document.getElementById("trips").scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
})();
`;

