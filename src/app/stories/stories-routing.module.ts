import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StoryEditorComponent } from './components/story-editor.component';
import { StorySettingsComponent } from './components/story-settings.component';
import { CodexComponent } from './components/codex.component';
import { NovelCrafterImportComponent } from './components/novelcrafter-import.component';
import { ImageGenerationComponent } from './components/image-generation.component';
import { SceneChatComponent } from './components/scene-chat.component';

const routes: Routes = [
  {
    path: 'editor/:id',
    component: StoryEditorComponent
  },
  {
    path: 'settings/:id',
    component: StorySettingsComponent
  },
  {
    path: 'codex/:id',
    component: CodexComponent
  },
  {
    path: 'import/novelcrafter',
    component: NovelCrafterImportComponent
  },
  {
    path: 'image-generation',
    component: ImageGenerationComponent
  },
  {
    path: 'scene-chat/:storyId/:sceneId',
    component: SceneChatComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class StoriesRoutingModule { }