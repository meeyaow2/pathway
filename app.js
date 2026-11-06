(()=>{'use strict';
const $=id=>document.getElementById(id);const qs=s=>document.querySelectorAll(s);
const places={orchard:{name:'Orchard MRT',lat:1.3046,lng:103.8318},paragon:{name:'Paragon',lat:1.3035,lng:103.8355},ngeeann:{name:'Ngee Ann City',lat:1.3029,lng:103.8346},somerset:{name:'Somerset MRT',lat:1.3004,lng:103.8390},ion:{name:'ION Orchard',lat:1.3040,lng:103.8318}};
const scenarios=[{name:'Step-free concept',detail:'This concept prioritises step-free access, but has no verified ramp, curb, gradient or lift observations.'},{name:'Shelter concept',detail:'This concept prioritises sheltered travel, but there is no validated sheltered-pedestrian network connected.'},{name:'Rest-stop concept',detail:'This concept prioritises rest opportunities, but available seating is not independently validated.'}];
const names={planner:['Find your way, your way.','A route that works for you matters more than the shortest one.'],reports:['Every observation matters.','Community observations with transparent verification status.'],saved:['Saved journeys.','Planning scenarios you can return to.'],about:['About Pathway.','Accessibility information should be accurate and transparent.']};
const state={page:'planner',mode:'demo',preferences:{stepfree:true,shelter:false,lifts:true,rest:false},scenario:0,liveStart:null,liveEnd:null,liveRoute:null,saved:[],reports:[]};
try{const a=JSON.parse(localStorage.getItem('pathway-v2')||'{}');state.saved=a.saved||[];state.preferences={...state.preferences,...(a.preferences||{})}}catch{}
const save=()=>{try{localStorage.setItem('pathway-v2',JSON.stringify({saved:state.saved,preferences:state.preferences}))}catch{}};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map=null,markers=[],line=null,liveGeometryLayer=null,livePossible=false;
let mapStyle='liberty';
const styles={liberty:'https://tiles.openfreemap.org/styles/liberty',positron:'https://tiles.openfreemap.org/styles/positron'};
function toast(t){$('toast').textContent=t;$('toast').style.display='block';clearTimeout(window._timer);window._timer=setTimeout(()=>$('toast').style.display='none',3100)}
async function get(path){const r=await fetch(path);const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d}
function setupMap(){
 if(!window.maplibregl){$('map').innerHTML='<div class="map-fallback"><div><h2>Map unavailable</h2><p>Connect to the internet to load the free OpenFreeMap map.</p></div></div>';return}
 $('map').innerHTML='';
 map=new maplibregl.Map({container:'map',style:styles[mapStyle],center:[103.8345,1.3035],zoom:15.5,minZoom:10,maxZoom:19,attributionControl:true});
 map.addControl(new maplibregl.NavigationControl({showCompass:true}),'bottom-right');
 map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left');
 map.on('load',drawMap);
 map.on('style.load',drawMap);
 map.on('error',e=>{if(e?.error)console.warn('Map rendering:',e.error.message)});
}
function placePair(){if(state.mode==='live'){return [state.liveStart,state.liveEnd]}return [places[$('start').value],places[$('end').value]]}
function pinElement(label){const el=document.createElement('div');el.className='pathway-pin';el.textContent=label;el.setAttribute('aria-label',label==='A'?'Starting point':'Destination');return el}
function clearMapOverlays(){
 markers.forEach(m=>m.remove());markers=[];
 if(!map)return;
 if(map.getLayer('pathway-route'))map.removeLayer('pathway-route');
 if(map.getSource('pathway-route'))map.removeSource('pathway-route');
}
function drawMap(){
 if(!map||!map.isStyleLoaded())return;
 clearMapOverlays();
 const [a,b]=placePair();if(!a||!b)return;
 [a,b].forEach((p,i)=>markers.push(new maplibregl.Marker({element:pinElement(i?'B':'A'),anchor:'center'}).setLngLat([p.lng,p.lat]).setPopup(new maplibregl.Popup({offset:20}).setText(p.name)).addTo(map)));
 let coords=[],isReal=false;
 if(state.liveRoute?.data?.route_geometry && state.mode==='live'){
   try{coords=decodePolyline(state.liveRoute.data.route_geometry).map(([lat,lng])=>[lng,lat]);isReal=true}catch{toast('Could not decode walking route')}
 }else if(state.mode==='demo'&&(a.lat!==b.lat||a.lng!==b.lng)){
   coords=[[a.lng,a.lat],[b.lng,b.lat]];
 }
 if(coords.length>1){
   map.addSource('pathway-route',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}}});
   map.addLayer({id:'pathway-route',type:'line',source:'pathway-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0b7669','line-width':5,'line-opacity':.9,...(!isReal?{'line-dasharray':[1.1,2.1]}:{})}});
 }
 const bounds=new maplibregl.LngLatBounds();bounds.extend([a.lng,a.lat]);bounds.extend([b.lng,b.lat]);
 if(a.lat===b.lat&&a.lng===b.lng){map.flyTo({center:[a.lng,a.lat],zoom:16,essential:false})}
 else map.fitBounds(bounds,{padding:{top:65,bottom:65,left:48,right:48},maxZoom:16,duration:0});
}
function selectStyle(style){
 if(!styles[style]||!map)return;
 mapStyle=style;
 ['liberty','positron'].forEach(p=>{const b=$('provider-'+p);if(b)b.setAttribute('aria-pressed',String(p===style))});
 map.setStyle(styles[style]);
}
function decodePolyline(str){let index=0,lat=0,lng=0,points=[];while(index<str.length){let b,shift=0,result=0;do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);lat+=(result&1)?~(result>>1):(result>>1);shift=0;result=0;do{b=str.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);lng+=(result&1)?~(result>>1):(result>>1);points.push([lat/1e5,lng/1e5])}return points}
function ranking(){const s=[(state.preferences.stepfree?3:0)+(state.preferences.lifts?2:0),state.preferences.shelter?5:0,state.preferences.rest?5:0];return [0,1,2].sort((a,b)=>s[b]-s[a]||a-b)}
function renderRoutes(){if(state.mode==='live'){
 const r=state.liveRoute?.data;
 $('route-source').textContent=r?'OneMap walking API':'Awaiting search';
 $('routes').innerHTML=r?'<div class="route-card active"><strong>Standard walking route</strong><p>Official walking geometry — accessibility unverified.</p><p>'+esc(r.route_summary?.total_distance??'—')+' m · '+esc(r.route_summary?.total_time??'—')+' s (API values)</p></div>':'<div class="notice">Find two Singapore locations, then request a standard walking route.</div>';
 $('details-title').textContent=r?'Standard walking route':'No route loaded';$('route-detail').textContent=r?'OneMap walking instructions do not establish step-free access, lift status, ramp suitability, or shelter. Do not treat this as an accessible route.':'OneMap location search requires configured credentials.';
 $('steps').innerHTML=(r?.route_instructions||[]).slice(0,12).map(x=>'<div class="step">'+esc(x[9]||x[0]||'Walking instruction')+'</div>').join('');return;}
 $('route-source').textContent='Concept only';$('routes').innerHTML=ranking().map(i=>`<button class="route-card ${i===state.scenario?'active':''}" data-scenario="${i}" aria-pressed="${state.scenario===i}"><div class="row"><strong>${scenarios[i].name}</strong>${ranking()[0]===i?'<span class="flag">Preference match</span>':''}</div><p>No actual walkway geometry · No measured distance</p></button>`).join('');
 qs('[data-scenario]').forEach(b=>b.addEventListener('click',()=>{state.scenario=+b.dataset.scenario;renderRoutes()}));
 $('details-title').textContent=scenarios[state.scenario].name;$('route-detail').textContent=scenarios[state.scenario].detail;$('steps').innerHTML='<div class="step">① Illustrative straight-line connection, not an actual walkway</div><div class="step">② No verified obstacle, lift or slope information</div><div class="step">③ Do not use for physical navigation</div>';
}
function changePage(page){state.page=page;['planner','reports','saved','about'].forEach(x=>$(x).classList.toggle('hidden',x!==page));qs('[data-page]').forEach(b=>{if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});$('title').textContent=names[page][0];$('subtitle').textContent=names[page][1];if(page==='reports')loadReports();if(page==='saved')renderSaved();if(page==='planner'&&map)setTimeout(()=>map.resize(),40)}
qs('[data-page]').forEach(b=>b.addEventListener('click',()=>changePage(b.dataset.page)));
function switchMode(mode){state.mode=mode;state.liveRoute=null;$('demo-fields').classList.toggle('hidden',mode!=='demo');$('live-fields').classList.toggle('hidden',mode!=='live');$('demo-mode').setAttribute('aria-pressed',String(mode==='demo'));$('live-mode').setAttribute('aria-pressed',String(mode==='live'));$('service-mode').textContent=mode==='demo'?'DEMO / UNVERIFIED':'ONEMAP / ACCESS UNVERIFIED';$('safety').textContent=mode==='demo'?'Demo journeys show illustrative straight-line connections only, not real pedestrian pathways. Never use them to navigate.':'OneMap standard walking routes are not certified accessible. Do not assume wheelchair suitability or working lifts.';renderRoutes();drawMap()}
$('demo-mode').onclick=()=>switchMode('demo');$('live-mode').onclick=()=>switchMode('live');['start','end'].forEach(id=>$(id).onchange=()=>{if($('start').value===$('end').value)toast('Choose different places');drawMap()});
qs('[data-pref]').forEach(b=>{const k=b.dataset.pref;b.setAttribute('aria-pressed',String(state.preferences[k]));b.addEventListener('click',()=>{state.preferences[k]=!state.preferences[k];b.setAttribute('aria-pressed',String(state.preferences[k]));save();renderRoutes()})});
$('plan').onclick=async()=>{if(state.mode==='demo'){if($('start').value===$('end').value)return toast('Choose two different places');state.scenario=ranking()[0];renderRoutes();drawMap();toast('Updated illustrative scenarios; not usable routes');return}
 if(!state.liveStart||!state.liveEnd)return toast('Search and select both locations first');$('plan').disabled=true;$('plan').textContent='Searching OneMap…';try{state.liveRoute=await get('/api/route?'+new URLSearchParams({start:`${state.liveStart.lat},${state.liveStart.lng}`,end:`${state.liveEnd.lat},${state.liveEnd.lng}`}));renderRoutes();drawMap();toast('Standard walking route loaded — accessibility unverified')}catch(e){toast(e.message)}finally{$('plan').disabled=false;$('plan').textContent='Find route →'}};
async function searchLocation(which){const query=$(which+'-search').value.trim();if(query.length<3)return toast('Enter at least 3 characters');let select=$(which+'-results');select.innerHTML='<option>Searching…</option>';
 try{const res=await get('/api/search?q='+encodeURIComponent(query));const results=res.results||[];if(!results.length){select.innerHTML='<option>No results</option>';return}select.innerHTML=results.slice(0,15).map((r,i)=>`<option value="${i}">${esc(r.SEARCHVAL||r.ADDRESS||'Location')} — ${esc(r.POSTAL||'')}</option>`).join('');select._items=results;applyResult(which);toast('Choose the correct search result')}catch(e){select.innerHTML='<option>Search unavailable</option>';toast(e.message)}}
function applyResult(which){const s=$(which+'-results');const r=s._items?.[+s.value];if(!r)return;const point={name:r.SEARCHVAL||r.ADDRESS||'Place',lat:Number(r.LATITUDE),lng:Number(r.LONGITUDE)};if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng))return;state[which==='start'?'liveStart':'liveEnd']=point;state.liveRoute=null;renderRoutes();drawMap()}
['start','end'].forEach(w=>{$('lookup-'+w).onclick=()=>searchLocation(w);$(w+'-results').onchange=()=>applyResult(w)});
$('locate').onclick=()=>{if(!navigator.geolocation)return toast('Geolocation not available');navigator.geolocation.getCurrentPosition(p=>{if(map)map.flyTo({center:[p.coords.longitude,p.coords.latitude],zoom:16,essential:false});toast('Map centred near your location — not used for routing')},()=>toast('Location permission denied or unavailable'),{enableHighAccuracy:false,timeout:7000})};
$('save').onclick=()=>{if(state.mode==='demo'&&$('start').value===$('end').value)return toast('Choose different places');const [a,b]=placePair();if(!a||!b)return toast('Select both locations');state.saved.unshift({id:Date.now(),from:a.name,to:b.name,mode:state.mode,preferences:{...state.preferences},created:new Date().toLocaleDateString('en-SG')});state.saved=state.saved.slice(0,40);save();toast('Planning scenario saved in this browser')};
function renderSaved(){$('saved-list').innerHTML=state.saved.length?state.saved.map(x=>`<div class="report"><div><strong>${esc(x.from)} → ${esc(x.to)}</strong><p>${esc(x.mode)} planning scenario · ${esc(x.created)} · Not a verified route</p></div><button class="outline" data-remove="${x.id}">Remove</button></div>`).join(''):'<div class="notice">No saved journeys yet. Plan a scenario and press Save.</div>';qs('[data-remove]').forEach(b=>b.onclick=()=>{state.saved=state.saved.filter(x=>String(x.id)!==b.dataset.remove);save();renderSaved()})}
function openModal(){$('modal').classList.remove('hidden');$('where').focus()}function closeModal(){$('modal').classList.add('hidden')}
$('report').onclick=openModal;$('new-report').onclick=openModal;$('close-modal').onclick=closeModal;$('cancel-report').onclick=closeModal;$('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
$('report-form').onsubmit=async e=>{e.preventDefault();const payload={location:$('where').value.trim(),category:$('category').value,description:$('description').value.trim()};
 try{const r=await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw Error(d.error||'Submission failed');$('report-form').reset();closeModal();changePage('reports');toast('Report submitted as unverified')}catch(err){toast(err.message)}};
async function loadReports(){try{const data=await get('/api/reports');$('report-count').textContent=data.reports.length;$('report-list').innerHTML=data.reports.length?data.reports.map(x=>`<div class="report"><div><strong>${esc(x.category)}</strong><p>${esc(x.location)} · ${new Date(x.created_at*1000).toLocaleDateString('en-SG')}</p><p>${esc(x.description)}</p></div><span>Unverified</span></div>`).join(''):'<div class="notice">No submissions yet. Start by reporting a potential accessibility obstacle.</div>'}catch(e){$('report-list').innerHTML='<div class="callout">Could not load reports: '+esc(e.message)+'</div>'}}
$('provider-liberty').onclick=()=>selectStyle('liberty');
$('provider-positron').onclick=()=>selectStyle('positron');
async function startup(){setupMap();renderRoutes();try{const res=await get('/api/status');if(res.onemap_connected){$('live-mode').title='OneMap credentials configured';}else{$('live-mode').title='Requires OneMap credentials configured on server'}}catch{} }startup();
})();