import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { 
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip, IonIcon, IonButton, 
  IonHeader, IonToolbar, IonTitle, IonButtons, IonContent
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { add, download, settings, analytics, trash, create, image, menu, close } from 'ionicons/icons';
import { StoryService } from '../services/story.service';
import { Story } from '../models/story.interface';
import { SyncStatusComponent } from '../../shared/components/sync-status.component';
import { LoginComponent } from '../../shared/components/login.component';
import { AuthService, User } from '../../core/services/auth.service';

@Component({
  selector: 'app-story-list',
  standalone: true,
  imports: [
    CommonModule, 
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip, IonIcon, IonButton, 
    IonHeader, IonToolbar, IonTitle, IonButtons, IonContent,
    SyncStatusComponent, LoginComponent
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Meine Geschichten</ion-title>
        <ion-buttons slot="end">
          <div class="header-info" *ngIf="currentUser">
            <span class="user-greeting">👋 {{ currentUser.displayName || currentUser.username }}</span>
            <app-sync-status [showActions]="false" class="compact-sync-status"></app-sync-status>
          </div>
          <ion-button fill="clear" color="medium" (click)="toggleBurgerMenu()">
            <ion-icon [name]="burgerMenuOpen ? 'close' : 'menu'" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <!-- Burger Menu Overlay -->
    <div class="burger-menu-overlay" *ngIf="burgerMenuOpen" (click)="closeBurgerMenu()"></div>
    
    <!-- Burger Menu -->
    <div class="burger-menu" [class.open]="burgerMenuOpen">
      <div class="burger-menu-content">
        <div class="burger-menu-header">
          <h3>Navigation</h3>
          <ion-button fill="clear" color="medium" (click)="toggleBurgerMenu()">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </div>
        
        <div class="burger-menu-items">
          <ion-button fill="clear" expand="block" (click)="goToAILogger(); closeBurgerMenu()">
            <ion-icon name="analytics" slot="start"></ion-icon>
            AI Logs
          </ion-button>
          <ion-button fill="clear" expand="block" (click)="goToSettings(); closeBurgerMenu()">
            <ion-icon name="settings" slot="start"></ion-icon>
            Einstellungen
          </ion-button>
          <ion-button fill="clear" expand="block" (click)="goToImageGeneration(); closeBurgerMenu()">
            <ion-icon name="image" slot="start"></ion-icon>
            Bildgenerierung
          </ion-button>
          <ion-button fill="clear" expand="block" (click)="importNovelCrafter(); closeBurgerMenu()">
            <ion-icon name="download" slot="start"></ion-icon>
            NovelCrafter Import
          </ion-button>
        </div>
        
        <div class="burger-menu-footer" *ngIf="currentUser">
          <app-sync-status [showActions]="true" class="full-sync-status"></app-sync-status>
          <ion-button fill="clear" color="danger" (click)="logout(); closeBurgerMenu()">
            Abmelden
          </ion-button>
        </div>
      </div>
    </div>

    <ion-content>
      <div class="story-list-container">
      
      <div class="action-buttons">
        <ion-button expand="block" size="large" color="primary" (click)="createNewStory()">
          <ion-icon name="add" slot="start"></ion-icon>
          Neue Geschichte schreiben
        </ion-button>
        <ion-button expand="block" size="large" fill="outline" color="medium" (click)="importNovelCrafter()">
          <ion-icon name="download" slot="start"></ion-icon>
          NovelCrafter Import
        </ion-button>
        <ion-button expand="block" size="large" fill="outline" color="secondary" (click)="goToImageGeneration()">
          <ion-icon name="image" slot="start"></ion-icon>
          Bildgenerierung
        </ion-button>
      </div>
      
      <div class="stories-grid" *ngIf="stories.length > 0; else noStories">
        <ion-card class="story-card" *ngFor="let story of stories" (click)="openStory(story.id)" button>
          <ion-card-header>
            <div class="card-header-content">
              <ion-card-title>{{ story.title || 'Unbenannte Geschichte' }}</ion-card-title>
              <ion-button fill="clear" size="small" color="danger" (click)="deleteStory($event, story.id)">
                <ion-icon name="trash" slot="icon-only"></ion-icon>
              </ion-button>
            </div>
          </ion-card-header>
          <ion-card-content>
            <p class="story-preview">{{ getStoryPreview(story) }}</p>
            <div class="story-chips">
              <ion-chip color="medium">
                <span>{{ getWordCount(story) }} Wörter</span>
              </ion-chip>
              <ion-chip color="medium">
                <span>{{ story.updatedAt | date:'short' }}</span>
              </ion-chip>
            </div>
          </ion-card-content>
        </ion-card>
      </div>
      
      <ng-template #noStories>
        <div class="no-stories">
          <p>Noch keine Geschichten vorhanden.</p>
          <p>Beginne mit dem Schreiben deiner ersten Geschichte!</p>
        </div>
      </ng-template>
      
      <!-- Login Modal -->
      <app-login></app-login>
      
      <!-- Mobile FAB Button -->
      <div class="mobile-fab-container">
        <button class="mobile-fab-button" (click)="toggleFabMenu()">
          <ion-icon name="add"></ion-icon>
        </button>
        <div class="mobile-fab-menu" *ngIf="fabMenuOpen">
          <button class="mobile-fab-option" (click)="createNewStory()">
            <ion-icon name="create"></ion-icon>
            <span>Neue Geschichte</span>
          </button>
          <button class="mobile-fab-option" (click)="importNovelCrafter()">
            <ion-icon name="download"></ion-icon>
            <span>Import</span>
          </button>
          <button class="mobile-fab-option" (click)="goToImageGeneration()">
            <ion-icon name="image"></ion-icon>
            <span>Bilder</span>
          </button>
        </div>
      </div>
      </div>
    </ion-content>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      background-color: #1a1a1a;
    }
    
    ion-content {
      --background: #1a1a1a;
    }
    
    .story-list-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background-color: #1a1a1a;
    }
    
    
    /* Desktop optimizations for compact header */
    @media (min-width: 768px) {
      ion-header {
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      
      ion-toolbar {
        --min-height: 44px;
        --padding-top: 4px;
        --padding-bottom: 4px;
      }
      
    }
    
    /* Header Info Styles */
    .header-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-right: 0.5rem;
    }
    
    .user-greeting {
      color: #f8f9fa;
      font-size: 0.8rem;
      font-weight: 500;
      white-space: nowrap;
    }
    
    .compact-sync-status {
      opacity: 0.8;
    }
    
    @media (max-width: 767px) {
      .header-info {
        display: none;
      }
    }
    
    /* Burger Menu Styles */
    .burger-menu-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9998;
      backdrop-filter: blur(2px);
    }
    
    .burger-menu {
      position: fixed;
      top: 0;
      right: -300px;
      width: 300px;
      height: 100%;
      background: #2d2d2d;
      border-left: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 9999;
      transition: right 0.3s ease-in-out;
      box-shadow: -4px 0 8px rgba(0, 0, 0, 0.3);
    }
    
    .burger-menu.open {
      right: 0;
    }
    
    .burger-menu-content {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 0;
    }
    
    .burger-menu-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      background: #343434;
    }
    
    .burger-menu-header h3 {
      margin: 0;
      color: #f8f9fa;
      font-size: 1.2rem;
      font-weight: 600;
    }
    
    .burger-menu-items {
      flex: 1;
      padding: 1rem 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .burger-menu-items ion-button {
      --color: #f8f9fa;
      --background: transparent;
      --background-hover: rgba(255, 255, 255, 0.1);
      --background-focused: rgba(255, 255, 255, 0.1);
      --ripple-color: rgba(255, 255, 255, 0.2);
      margin: 0 1rem;
      height: 48px;
      font-size: 1rem;
      justify-content: flex-start;
      text-align: left;
    }
    
    .burger-menu-items ion-button:hover {
      --background: rgba(255, 255, 255, 0.1);
    }
    
    .burger-menu-items ion-button ion-icon {
      margin-right: 12px;
      font-size: 1.2rem;
    }
    
    .burger-menu-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding: 1rem;
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .burger-menu-footer ion-button {
      --color: #ff6b6b;
      --background: transparent;
      --background-hover: rgba(255, 107, 107, 0.1);
      --background-focused: rgba(255, 107, 107, 0.1);
      --ripple-color: rgba(255, 107, 107, 0.2);
      height: 40px;
      font-size: 0.9rem;
    }
    
    .full-sync-status {
      align-self: stretch;
    }
    
    
    
    .action-buttons {
      display: flex;
      gap: 1rem;
      margin: 0 auto 2rem;
      max-width: 600px;
      flex-wrap: wrap;
    }
    
    .action-buttons ion-button {
      flex: 1;
      min-width: 200px;
    }
    
    /* Custom Mobile FAB */
    .mobile-fab-container {
      display: none;
    }
    
    @media (max-width: 767px) {
      .mobile-fab-container {
        display: block;
        position: fixed;
        bottom: 100px;
        right: 20px;
        z-index: 9999;
      }
    }
    
    .mobile-fab-button {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background-color: #3880ff;
      color: white;
      border: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      cursor: pointer;
      transition: transform 0.2s ease;
    }
    
    .mobile-fab-button:active {
      transform: scale(0.95);
    }
    
    .mobile-fab-menu {
      position: absolute;
      bottom: 70px;
      right: 0;
      background: var(--ion-color-dark);
      border-radius: 8px;
      padding: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
    }
    
    .mobile-fab-option {
      display: flex;
      align-items: center;
      gap: 8px;
      background: transparent;
      color: white;
      border: none;
      padding: 12px 16px;
      width: 100%;
      text-align: left;
      cursor: pointer;
      border-radius: 4px;
    }
    
    .mobile-fab-option:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    
    .mobile-fab-option ion-icon {
      font-size: 20px;
    }
    
    
    /* Hide action buttons on mobile, show FAB */
    @media (max-width: 767px) {
      .story-list-container {
        padding-bottom: 8rem;
      }
      
      .action-buttons {
        display: none;
      }
      
      
    }
    
    @media (max-width: 480px) {
      .story-list-container {
        padding: 1rem 0.5rem 10rem;
      }
      
      
      .stories-grid {
        grid-template-columns: 1fr;
        gap: 0.75rem;
        padding: 0;
      }
    }
    
    .stories-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
      padding: 0 8px;
    }
    
    .story-card {
      margin: 0;
      transition: transform 0.2s ease;
    }
    
    .story-card:hover {
      transform: translateY(-4px);
    }
    
    .card-header-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      width: 100%;
    }
    
    .card-header-content ion-card-title {
      flex: 1;
      margin-right: 8px;
      font-size: 1.1rem;
    }
    
    .story-preview {
      color: var(--ion-color-medium);
      line-height: 1.4;
      margin: 0 0 12px 0;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      font-size: 0.9rem;
    }
    
    .story-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    
    .story-chips ion-chip {
      font-size: 0.75rem;
    }
    
    .no-stories {
      text-align: center;
      padding: 3rem;
      color: #adb5bd;
    }
    
    .no-stories p {
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }
  `]
})
export class StoryListComponent implements OnInit {
  stories: Story[] = [];
  currentUser: User | null = null;
  fabMenuOpen = false;
  burgerMenuOpen = false;

  constructor(
    private storyService: StoryService,
    private router: Router,
    private authService: AuthService
  ) {
    // Register Ionic icons
    addIcons({ add, download, settings, analytics, trash, create, image, menu, close });
  }

  ngOnInit(): void {
    this.loadStories();
    
    // Subscribe to user changes
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      // Reload stories when user changes (different database)
      this.loadStories();
    });
  }

  logout(): void {
    if (confirm('Möchten Sie sich wirklich abmelden? Lokale Änderungen bleiben erhalten.')) {
      this.authService.logout();
    }
  }

  async loadStories(): Promise<void> {
    this.stories = await this.storyService.getAllStories();
  }

  toggleFabMenu(): void {
    this.fabMenuOpen = !this.fabMenuOpen;
  }

  toggleBurgerMenu(): void {
    this.burgerMenuOpen = !this.burgerMenuOpen;
  }

  closeBurgerMenu(): void {
    this.burgerMenuOpen = false;
  }

  async createNewStory(): Promise<void> {
    this.fabMenuOpen = false;
    const newStory = await this.storyService.createStory();
    this.router.navigate(['/stories/editor', newStory.id]);
  }

  openStory(storyId: string): void {
    this.router.navigate(['/stories/editor', storyId]);
  }

  goToSettings(): void {
    this.router.navigate(['/settings']);
  }

  goToAILogger(): void {
    this.router.navigate(['/logs']);
  }

  importNovelCrafter(): void {
    this.fabMenuOpen = false;
    this.router.navigate(['/stories/import/novelcrafter']);
  }

  goToImageGeneration(): void {
    this.fabMenuOpen = false;
    this.router.navigate(['/stories/image-generation']);
  }

  async deleteStory(event: Event, storyId: string): Promise<void> {
    event.stopPropagation();
    if (confirm('Möchten Sie diese Geschichte wirklich löschen?')) {
      await this.storyService.deleteStory(storyId);
      await this.loadStories();
    }
  }

  getStoryPreview(story: Story): string {
    // For legacy stories with content
    if (story.content) {
      return story.content.length > 150 ? story.content.substring(0, 150) + '...' : story.content;
    }
    
    // For new chapter/scene structure
    if (story.chapters && story.chapters.length > 0 && story.chapters[0].scenes && story.chapters[0].scenes.length > 0) {
      const firstScene = story.chapters[0].scenes[0];
      const content = firstScene.content || '';
      return content.length > 150 ? content.substring(0, 150) + '...' : content;
    }
    
    return 'Noch kein Inhalt...';
  }

  getWordCount(story: Story): number {
    // For legacy stories with content
    if (story.content) {
      return story.content.trim().split(/\s+/).filter(word => word.length > 0).length;
    }
    
    // For new chapter/scene structure - count all scenes
    let totalWords = 0;
    if (story.chapters) {
      story.chapters.forEach(chapter => {
        if (chapter.scenes) {
          chapter.scenes.forEach(scene => {
            const content = scene.content || '';
            totalWords += content.trim().split(/\s+/).filter(word => word.length > 0).length;
          });
        }
      });
    }
    
    return totalWords;
  }
}