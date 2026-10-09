'use strict';

const PROJECTS = Object.freeze({
  amurskmarket: Object.freeze({
    id: 'amurskmarket', displayName: 'amurskmarket.ru',
    host: 'stores-web1', kind: 'public-site',
    checks: Object.freeze([
      Object.freeze({path:'/',expect:200,required:true}),
      Object.freeze({path:'/api/health',expect:200,jsonStatus:'ok',required:true}),
      Object.freeze({path:'/robots.txt',expect:200,required:true}),
      Object.freeze({path:'/sitemap.xml',expect:200,required:true}),
    ]),
    origin:'https://amurskmarket.ru',
  }),
  vozdooh: Object.freeze({
    id: 'vozdooh', displayName:'vozdooh27.ru',
    host:'stores-web1', kind:'public-site',
    checks: Object.freeze([
      Object.freeze({path:'/',expect:200,required:true}),
      Object.freeze({path:'/robots.txt',expect:200,required:true}),
      Object.freeze({path:'/sitemap.xml',expect:200,required:true}),
    ]),
    origin:'https://vozdooh27.ru',
  }),
  'business-kpi': Object.freeze({
    id:'business-kpi', displayName:'Amursk KPI portal',
    host:'amursk-windows', kind:'docker-local',
    container:'business-kpi-local-web',
  }),
  purchasing: Object.freeze({
    id:'purchasing', displayName:'Miska purchasing service',
    host:'amursk-windows', kind:'docker-local',
    container:'purchasing-web-backend',
  }),
  arthur: Object.freeze({
    id:'arthur', displayName:'Arthur Telegram Gateway',
    host:'amursk-windows',kind:'docker-local',
    container:'arthur-core-telegram-gateway-1',
  }),
});

module.exports = { PROJECTS };
