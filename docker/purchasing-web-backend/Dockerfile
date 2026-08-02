FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY agents ./agents
COPY apps ./apps

ENV NODE_ENV=production \
    PURCHASING_WEB_HOST=0.0.0.0 \
    PURCHASING_WEB_PORT=3210

EXPOSE 3210

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "const http=require('node:http');const fail=message=>{console.error('healthcheck failed: '+message);process.exit(1)};const request=http.get({hostname:'127.0.0.1',port:3210,path:'/api/v1/health',headers:{accept:'application/json','x-api-key':process.env.PURCHASING_API_TOKEN}},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>65536)request.destroy(new Error('response exceeds 65536 bytes'))});response.on('end',()=>{let json;try{json=JSON.parse(body)}catch{fail('non-JSON response: HTTP '+response.statusCode+' body='+JSON.stringify(body.slice(0,240)));return}const data=json&&json.data;const expected=process.env.PURCHASING_BUILD_SHA;const errors=[];if(response.statusCode!==200)errors.push('HTTP '+response.statusCode);if(data&&data.service!=='purchasing-web')errors.push('service='+JSON.stringify(data.service));if(!data)errors.push('data is missing');if(data&&data.build_sha!==expected)errors.push('build_sha='+JSON.stringify(data.build_sha)+' expected='+JSON.stringify(expected));if(errors.length)fail(errors.join('; '))})});request.setTimeout(4000,()=>request.destroy(new Error('request timeout')));request.on('error',error=>fail(error.message))"]

CMD ["node", "apps/purchasing-web-backend/server.js"]
