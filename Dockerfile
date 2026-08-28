# Statischer Webserver für den Zugsimulator – winziges Image auf nginx:alpine.
FROM nginx:alpine

# Nur die für das Spiel nötigen Dateien ausliefern
COPY index.html style.css game.js /usr/share/nginx/html/

EXPOSE 80

# Einfacher Healthcheck: Startseite muss erreichbar sein
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
