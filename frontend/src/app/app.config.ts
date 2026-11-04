import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { OsrmRoutingService } from './routing/osrm-routing.service';
import { ROUTING_PROVIDER } from './routing/routing-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    OsrmRoutingService,
    { provide: ROUTING_PROVIDER, useExisting: OsrmRoutingService },
  ],
};
