# Purchasing production container

The application binds to `0.0.0.0` inside the container so Docker port publishing works. Production must publish it on server loopback only (`127.0.0.1:3210:3210`) unless a protected reverse proxy is deliberately configured.

Persist `/app/data/purchasing` for owner decisions and learned state, and `/app/output` for run artifacts. Do not bake secrets into the image.
