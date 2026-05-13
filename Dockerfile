FROM busybox:1.36.1-musl

COPY index.html /www/index.html

CMD ["httpd", "-f", "-p", "8080", "-h", "/www"]
