import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IonApp } from '@ionic/angular/standalone';
import { BackgroundService } from './shared/services/background.service';
import { BeatAIModalService } from './shared/services/beat-ai-modal.service';
import { BeatAIPreviewModalComponent } from './stories/components/beat-ai-preview-modal/beat-ai-preview-modal.component';
import { MemoryWarningService } from './core/services/memory-warning.service';
import { BeatHistoryService } from './shared/services/beat-history.service';
import { SubscriptionService } from './core/services/subscription.service';
import { PendingJobsService } from './core/services/pending-jobs.service';
import { AIErrorInterceptorService } from './core/services/ai-error-interceptor.service';

// Preload PouchDB modules to avoid lazy loading delay during database initialization
import PouchDB from 'pouchdb-browser';
import PouchDBFind from 'pouchdb-find';

// Register PouchDB plugins at app startup with error handling
try {
  PouchDB.plugin(PouchDBFind);
  console.log('PouchDB initialized successfully');
} catch (error) {
  console.error('Error initializing PouchDB:', error);
  // Continue execution - DatabaseService will handle errors gracefully
}

// Export for DatabaseService to use
export { PouchDB };

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, IonApp, BeatAIPreviewModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected title = 'creativewriter2';
  private backgroundService = inject(BackgroundService);
  protected modalService = inject(BeatAIModalService);
  private memoryWarning = inject(MemoryWarningService);
  private beatHistoryService = inject(BeatHistoryService);
  private subscriptionService = inject(SubscriptionService);
  private pendingJobsService = inject(PendingJobsService);
  // Injected to initialize the service at app startup - subscribes to AI error logs and shows toast notifications
  private aiErrorInterceptor = inject(AIErrorInterceptorService);

  constructor() {
    // Initialize background service to apply global background
    // The service will automatically handle background changes

    // Memory warning service automatically starts monitoring on mobile
    // Configure if needed: this.memoryWarning.updateConfig({ warningThreshold: 85 });

    // Initialize beat version history database
    this.beatHistoryService.initialize().catch(error => {
      console.error('[App] Failed to initialize beat history service:', error);
    });

    // Initialize subscription status from cache on app startup
    // This restores premium status without requiring manual verification
    this.subscriptionService.initialize();

    // Initialize pending jobs service for server-side generation recovery
    this.pendingJobsService.initialize().catch(error => {
      console.error('[App] Failed to initialize pending jobs service:', error);
    });
  }
}
