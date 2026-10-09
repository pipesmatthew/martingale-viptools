/* Traffic counting for the viptools suite. One page view, one POST, no state.

   AN EXTERNAL FILE, NOT AN INLINE BLOCK. Every page on this site is served with
   `script-src 'self'` and no 'unsafe-inline', so an inline <script> is dropped
   silently - the page renders, nothing runs, and there is no console error to
   notice. /docs/ shipped that way once. Every page here loads its JS as a file.

   NOTHING IS STORED ON THE VISITOR'S MACHINE. No cookie, no localStorage, no
   id of any kind. The server counts a visitor as a daily hash of IP and user
   agent, which it cannot reverse and cannot join to yesterday, so there is
   nothing for this file to keep or to ask permission for.

   IT FAILS SILENTLY AND ON PURPOSE. A counting failure is not a page failure:
   there is nothing to retry, nothing to show, and nothing the visitor could do.
   A beacon that complains in the console is a beacon that teaches people to
   block it.

   TEXT/PLAIN IS DELIBERATE. It is a CORS-safelisted content type, so this never
   triggers a preflight - one request per view instead of two, and one less
   thing that can fail. The server parses the body regardless of what it is
   labelled. */
(function () {
  "use strict";

  var API = "https://predictions.viptools.gg/api/hits/collect";

  /* THE FRAGMENT IS PART OF THE PAGE, not decoration. Routing across this
     suite is hash-based, so pathname alone would report every view as "/".
     The query string is left off here as well as on the server: it is the half
     that can carry a Twitch ?code= or a share token. */
  function page() {
    return location.pathname + (location.hash || "");
  }

  var last = "";

  function send() {
    var p = page();
    if (p === last) return;     /* a hashchange that did not change the page */
    last = p;
    try {
      fetch(API, {
        method: "POST",
        /* Survives the page being navigated away from mid-flight, which is
           most of the short visits worth counting. */
        keepalive: true,
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ path: p, ref: document.referrer || "" })
      }).catch(function () {});
    } catch (e) {}
  }

  send();

  /* Hash-based routing means a second page never reloads the document, so
     without this the whole suite would report one view per visit no matter how
     far anyone browsed. */
  window.addEventListener("hashchange", send);

  /* A back-forward cache restore is a real view: the page was shown again, and
     nothing else fires when it is. */
  window.addEventListener("pageshow", function (e) {
    if (e && e.persisted) { last = ""; send(); }
  });
})();
