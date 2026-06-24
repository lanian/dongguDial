/**
 * 앱 버전 단일 출처(Single Source of Truth).
 * 이 파일의 버전만 올리면 app.js(표시·업데이트 확인)와 sw.js(캐시명 donggu-dial-vNN)가
 * 함께 갱신된다. (sw.js 는 importScripts 로, index.html 은 <script> 로 이 값을 읽음)
 */
var APP_VERSION = "178";
// 워커/윈도우 양쪽 전역에 노출(환경에 따라 var 전역 바인딩이 다를 수 있어 명시적으로 보강)
if (typeof self !== "undefined") self.APP_VERSION = APP_VERSION;
