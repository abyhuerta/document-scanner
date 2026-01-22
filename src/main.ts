import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
// import { getidk } from './environments/environment';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

  // getidk().then(data => console.log(data));