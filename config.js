/* Visitor counters — these values are PUBLIC (safe to commit to a public repo).
   Fill them in to turn the counters on; leave blank/null to hide them. */
window.SB_CONFIG = {
  // ---- Total visits + history (GoatCounter) ----
  // 1. Make a free site at https://www.goatcounter.com/  (pick a code, e.g. "bf6sfx").
  // 2. In its Settings, enable the visitor counter ("Allow visitors to see the count").
  // 3. Put your code (the subdomain part) here:  e.g.  bf6sfx.goatcounter.com  ->  'bf6sfx'
  goatcounter: '',

  // ---- Live "online now" count (Firebase Realtime Database) ----
  // 1. Create a free Firebase project at https://console.firebase.google.com/
  // 2. Add a Web app; enable "Realtime Database" (start in test mode).
  // 3. Paste the firebaseConfig object the console gives you here (keep the braces). Leave null to disable.
  firebase: null,
  // example:
  // firebase: { apiKey:"...", authDomain:"...", databaseURL:"https://xxxx.firebaseio.com", projectId:"...", appId:"..." },
};
