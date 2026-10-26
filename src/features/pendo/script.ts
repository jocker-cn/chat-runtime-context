import type { PendoConfig } from "./client";

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** The official installation snippet, ready for a root-level <script> / next/script. */
export function createPendoScript(config: PendoConfig): string {
  if (!config.enabled || !/^[a-f0-9-]{32,36}$/i.test(config.publicAppId)) return "";
  const options = {
    visitor: {
      ...(config.visitorId ? { id: config.visitorId } : {}),
      ...(config.environment ? { environment: config.environment } : {}),
    },
    ...(config.accountId ? { account: { id: config.accountId } } : {}),
    // Existing collection limits stay in initialize options, not in a second loader.
    excludeAllText: true,
    allowedText: [],
    analytics: { excludeEvents: ["focus", "change", "submit"] },
    interceptPreventDefault: false,
    interceptStopPropagation: false,
    syntheticClicks: { elementRemoval: false, targetChanged: false },
    guides: { disabled: true },
    recording: { enabled: false, autoStart: false },
    location: { transforms: [{ attr: "search", action: "Clear" }, { attr: "hash", action: "Clear" }] },
  };
  return `window.__appPendoConfig = ${json({ enabled: true, environment: config.environment })};
(function(publicAppId){
    (function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
    v=['initialize','identify','updateOptions','pageLoad','track','trackAgent'];for(w=0,x=v.length;w<x;++w)(function(m){
        o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
        y=e.createElement(n);y.async=!0;y.src='https://cdn.pendo.io/agent/static/'+publicAppId+'/pendo.js';
        z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');
    window.pendo.initialize(${json(options)});
})(${json(config.publicAppId)});
document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') window.pendo?.flushNow?.({hidden:true});
});
window.addEventListener('pagehide', function(){ window.pendo?.flushNow?.({unload:true}); });`;
}
