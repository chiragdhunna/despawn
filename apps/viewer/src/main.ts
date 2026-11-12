import { VERSION } from '@despawn/protocol';

const app = document.getElementById('app');
if (app) {
  const heading = document.createElement('h1');
  heading.textContent = 'Despawn shop viewer';

  const versionPara = document.createElement('p');
  versionPara.textContent = `Version: ${VERSION}`;

  app.appendChild(heading);
  app.appendChild(versionPara);
}
