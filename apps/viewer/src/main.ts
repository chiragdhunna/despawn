import './style.css';
import { detectLang } from './i18n.js';
import { ViewerSession } from './session.js';
import { Ui } from './ui.js';

const app = document.getElementById('app');
if (app !== null) {
  const ui = new Ui(
    app,
    detectLang(navigator.languages !== undefined ? navigator.languages : [navigator.language]),
  );
  const secure = window.location.protocol === 'https:';
  const session = new ViewerSession(ui, {
    pathname: window.location.pathname,
    hash: window.location.hash,
    userAgent: navigator.userAgent,
    wsBase: `${secure ? 'wss' : 'ws'}://${window.location.host}`,
    httpBase: window.location.origin,
  });
  void session.start();
}
