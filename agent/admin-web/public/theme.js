// Aplica o tema salvo antes da primeira pintura (arquivo externo: a CSP do painel proíbe script inline).
try {
  var t = localStorage.getItem("proops-admin-theme");
  if (t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
} catch (e) {}
