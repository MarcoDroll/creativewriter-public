import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges, inject, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonCard,
  IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, videocamOutline, imagesOutline, locateOutline } from 'ionicons/icons';
import { Story } from '../../models/story.interface';
import { StoryImageService } from '../../../shared/services/story-image.service';
import { StoryMediaService } from '../../../shared/services/story-media.service';
import { ImageViewerModalComponent } from '../../../shared/components/image-viewer-modal/image-viewer-modal.component';

interface MediaItem {
  imageId: string;
  imageSrc: string;
  hasVideo: boolean;
  videoId?: string;
  imageAlt?: string;
}

interface ImageMeta {
  id: string;
  name: string;
  videoId?: string;
}

// Pagination settings - load images in batches to prevent memory issues on mobile
const IMAGES_PER_PAGE = 20;

@Component({
  selector: 'app-story-media-gallery',
  standalone: true,
  imports: [
    CommonModule,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonSpinner,
    ImageViewerModalComponent
  ],
  templateUrl: './story-media-gallery.component.html',
  styleUrls: ['./story-media-gallery.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StoryMediaGalleryComponent implements OnInit, OnChanges, OnDestroy {
  @Input() story: Story | null = null;
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  @Output() jumpToImage = new EventEmitter<{ imageId: string }>();

  mediaItems: MediaItem[] = [];
  isLoading = false;
  isLoadingMore = false;
  selectedMediaItem: MediaItem | null = null;
  showImageViewer = false;
  loadingVideo = false;
  selectedVideoSrc: string | null = null;
  selectedVideoName: string | null = null;

  // Pagination state
  private allImagesMeta: ImageMeta[] = [];
  private loadedCount = 0;
  hasMoreImages = false;
  totalImagesCount = 0;

  // Track video blob URL for cleanup (images are managed by StoryImageService)
  private currentVideoBlobUrl: string | null = null;

  private storyImageService = inject(StoryImageService);
  private storyMediaService = inject(StoryMediaService);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    addIcons({ close, videocamOutline, imagesOutline, locateOutline });
  }

  ngOnInit(): void {
    if (this.isOpen && this.story) {
      void this.loadMediaItems();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.story) {
      void this.loadMediaItems();
    }
  }

  ngOnDestroy(): void {
    this.cleanupAllBlobUrls();
  }

  async loadMediaItems(): Promise<void> {
    if (!this.story?.id || this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.cdr.markForCheck();

    // Reset pagination state
    this.mediaItems = [];
    this.allImagesMeta = [];
    this.loadedCount = 0;

    try {
      const storyId = this.story.id;

      // Get all image metadata for this story (lightweight - no blob data)
      const images = await this.storyImageService.getImagesForStory(storyId);
      this.allImagesMeta = images.map(img => ({
        id: img.id,
        name: img.name,
        videoId: img.videoId
      }));
      this.totalImagesCount = this.allImagesMeta.length;
      this.hasMoreImages = this.totalImagesCount > IMAGES_PER_PAGE;

      // Load only the first batch of images
      await this.loadNextBatch();
    } catch (error) {
      console.error('Error loading media items:', error);
      this.mediaItems = [];
      this.allImagesMeta = [];
      this.totalImagesCount = 0;
      this.hasMoreImages = false;
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Load the next batch of images (pagination)
   */
  private async loadNextBatch(): Promise<void> {
    if (!this.story?.id) {
      return;
    }

    const storyId = this.story.id;
    const startIndex = this.loadedCount;
    const endIndex = Math.min(startIndex + IMAGES_PER_PAGE, this.allImagesMeta.length);
    const batchMeta = this.allImagesMeta.slice(startIndex, endIndex);

    const newItems: MediaItem[] = [];

    for (const imageMeta of batchMeta) {
      // Get blob URL for displaying the image
      const blobUrl = await this.storyImageService.getImageBlobUrl(storyId, imageMeta.id);
      if (!blobUrl) {
        // Skip images that couldn't be loaded
        console.warn(`Could not load blob URL for image ${imageMeta.id}`);
        continue;
      }

      newItems.push({
        imageId: imageMeta.id,
        imageSrc: blobUrl,
        hasVideo: !!imageMeta.videoId,
        videoId: imageMeta.videoId,
        imageAlt: imageMeta.name
      });
    }

    this.mediaItems = [...this.mediaItems, ...newItems];
    this.loadedCount = endIndex;
    this.hasMoreImages = this.loadedCount < this.allImagesMeta.length;
  }

  /**
   * Load more images (called by "Load More" button)
   */
  async loadMoreImages(): Promise<void> {
    if (!this.hasMoreImages || this.isLoadingMore) {
      return;
    }

    this.isLoadingMore = true;
    this.cdr.markForCheck();

    try {
      await this.loadNextBatch();
    } catch (error) {
      console.error('Error loading more images:', error);
    } finally {
      this.isLoadingMore = false;
      this.cdr.markForCheck();
    }
  }

  async onMediaItemClick(item: MediaItem): Promise<void> {
    this.selectedMediaItem = item;

    // Clean up previous video blob URL if any
    this.cleanupVideoBlobUrl();

    // If there's an associated video, load it
    if (item.hasVideo && item.videoId && this.story?.id) {
      this.loadingVideo = true;
      this.cdr.markForCheck();

      try {
        const videoMeta = await this.storyMediaService.getVideoMeta(this.story.id, item.videoId);
        if (videoMeta) {
          const blobUrl = await this.storyMediaService.getVideoBlobUrl(this.story.id, item.videoId);
          this.currentVideoBlobUrl = blobUrl;
          this.selectedVideoSrc = blobUrl;
          this.selectedVideoName = videoMeta.name;
        }
      } catch (error) {
        console.error('Error loading video:', error);
        this.selectedVideoSrc = null;
        this.selectedVideoName = null;
      } finally {
        this.loadingVideo = false;
        this.cdr.markForCheck();
      }
    } else {
      this.selectedVideoSrc = null;
      this.selectedVideoName = null;
    }

    this.showImageViewer = true;
    this.cdr.markForCheck();
  }

  onJumpToImage(imageId: string, event: Event): void {
    event.stopPropagation(); // Don't open viewer
    this.jumpToImage.emit({ imageId });
    this.onClose(); // Close gallery after jumping
  }

  onImageViewerClosed(): void {
    this.showImageViewer = false;
    this.selectedMediaItem = null;
    this.selectedVideoSrc = null;
    this.selectedVideoName = null;
    this.cleanupVideoBlobUrl();
    this.cdr.markForCheck();
  }

  onClose(): void {
    this.cleanupAllBlobUrls();
    this.closed.emit();
  }

  onModalDidDismiss(): void {
    this.cleanupAllBlobUrls();
    this.closed.emit();
  }

  // ===== Blob URL Cleanup Methods =====
  // Note: Image blob URLs are managed by StoryImageService (not cleaned up here)
  // Only video blob URLs are created locally and need cleanup

  private cleanupVideoBlobUrl(): void {
    if (this.currentVideoBlobUrl) {
      URL.revokeObjectURL(this.currentVideoBlobUrl);
      this.currentVideoBlobUrl = null;
    }
  }

  private cleanupAllBlobUrls(): void {
    this.cleanupVideoBlobUrl();
  }

  // trackBy function for mobile performance
  trackByImageId(index: number, item: MediaItem): string {
    return item.imageId;
  }
}
