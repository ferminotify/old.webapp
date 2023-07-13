function cookieConsent(bool) {
  if (bool) localStorage.setItem("cookieConsent", "true");
  else localStorage.clear();
  $("#cookieAlert").hide();
}

if (localStorage.getItem("cookieConsent") == "true") $("#cookieAlert").hide();
