/** @format */

import { ContextCommandBuilder, type ContextCommandOptions } from '@xernerx/framework';
import { ApplicationCommandType } from 'discord.js';
import { replyWithSubmissionsV2 } from '../slash/submissions.js';

export default class ApplicationsContextCommand extends ContextCommandBuilder {
	constructor() {
		super('Applications', {
			name: 'Applications',
			description: "View this member's applications in this server.",
			type: ApplicationCommandType.User,
			defer: false,
		});
	}

	override async exec({ interaction, user }: ContextCommandOptions<'user'>) {
		const ws = (this.client as any).websocket;
		const target = interaction.targetUser || (user as any)?.user || user;
		return replyWithSubmissionsV2(ws, interaction, target);
	}
}
