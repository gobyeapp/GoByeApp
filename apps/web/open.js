// "Open GoBye" links from WhatsApp quick booking (D-064). WhatsApp buttons need an https link, so they
// point here: /open/ride/<id> → gobye://open/ride/<id>, /open/signup → gobye://open/signup.
(function () {
  var path = window.location.pathname.replace(/\/+$/, '');
  var ride = /^\/open\/ride\/([A-Za-z0-9-]{8,64})$/.exec(path);
  var target = 'gobye://';
  if (ride) {
    target = 'gobye://open/ride/' + ride[1];
    document.getElementById('title').textContent = 'Your GoBye ride';
    document.getElementById('lead').textContent = 'Follow your driver, chat and pay in the GoBye app.';
  } else if (path === '/open/signup') {
    target = 'gobye://open/signup';
    document.getElementById('title').textContent = 'Create your GoBye account';
    document.getElementById('lead').textContent = 'Sign up in the app with the number you use on WhatsApp, then book on WhatsApp in seconds.';
  }
  document.getElementById('open').setAttribute('href', target);
  // Try once automatically; browsers that block it still have the button.
  window.setTimeout(function () { window.location.href = target; }, 300);
})();
