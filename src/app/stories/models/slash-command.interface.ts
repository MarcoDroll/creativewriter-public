export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: string;
  action: SlashCommandAction;
}

export enum SlashCommandAction {
  INSERT_BEAT = 'insert_beat',
  INSERT_IMAGE = 'insert_image'
}

export interface SlashCommandResult {
  action: SlashCommandAction;
  position: number;
  data?: unknown;
}