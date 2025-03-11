FROM --platform=linux/amd64 grafana/k6:latest
COPY script.js /script.js
ENTRYPOINT ["k6", "run", "--out", "json=/dev/stdout", "/script.js"]