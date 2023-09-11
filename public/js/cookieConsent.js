function cookieConsent(bool) {
  if (bool) localStorage.setItem("cookieConsent", "true");
  else localStorage.clear();
  $("#cookieAlert").hide();
}

if (localStorage.getItem("cookieConsent") != "true"){
  const cookieBody = `<div id="cookieAlert"><p class="cookieAlert-text"><span class="material-symbols-outlined" style="color: var(--primary-color)">cookie</span> Questo sito utilizza cookie per migliorare l'esperienza d'uso.</p><div class="cookieAlert-btn"><div class="cookieAlert-options"><a onclick="cookieConsent(true)" class="cookieAlert-accept-btn">Accetta</a><a onclick="cookieConsent(false)" class="cookieAlert-notaccept-btn">Rifiuta</a></div><a href="/faq?page=informativa"><span class="material-symbols-outlined">quick_reference_all</span> Dettagli</a></div></div>`;
  $("body").append(cookieBody);
}
