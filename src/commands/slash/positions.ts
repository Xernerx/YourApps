/** @format */

import { SlashCommandBuilder, type SlashCommandAutocomplete, type SlashCommandOptions } from '@xernerx/framework';
import { ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import { extractItems, resolveUserAccent } from '../../lib/guildSync.js';
import { buildPositionDetailV2, buildPositionsListV2 } from '../../lib/positionsView.js';

export default class PositionsCommand extends SlashCommandBuilder {
	constructor() {
		super('positions', {
			name: 'positions',
			description: 'View open and configured application positions on this server.',
			defer: false,
			options: [
				{
					type: 'string',
					name: 'position',
					description: 'Inspect questions and requirements for a specific position.',
					required: false,
					autocomplete: true,
				},
			],
		});
	}

	override async autocomplete({ interaction, focused }: SlashCommandAutocomplete) {
		if (!interaction.guildId) {
			await (interaction as any).respond([]);
			return;
		}
		const ws = (this.client as any).websocket;
		const res = await ws.get('yourapps', 'forms', { guild: interaction.guildId, search: String(focused.value || '') }).catch(() => null);
		const positions = extractItems(res);

		await (interaction as any).respond(
			positions.slice(0, 25).map((pos: any) => ({
				name: `${pos.state === 'open' ? '🟢' : '🔒'} ${pos.name}`.slice(0, 100),
				value: String(pos.id),
			}))
		);
	}

	override async exec({ interaction, options }: SlashCommandOptions) {
		if (!interaction.guild) return;
		const ws = (this.client as any).websocket;

		const posId = options?.position?.value ? String(options.position.value) : '';
		if (posId) {
			const [accent, pos] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'forms', { id: posId, guild: interaction.guild.id }).catch(() => null)]);

			if (!pos) {
				const notFound = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(new TextDisplayBuilder().setContent('Position not found.'));
				return interaction.util.reply({
					components: [notFound],
					display: true,
					ephemeral: true,
				});
			}

			const container = buildPositionDetailV2({ guildId: interaction.guild.id, position: pos, accent, returnPage: 0 });
			return interaction.util.reply({
				components: [container],
				display: true,
				ephemeral: true,
			});
		}

		const [accent, res] = await Promise.all([resolveUserAccent(ws, interaction.user.id), ws.get('yourapps', 'forms', { guild: interaction.guild.id }).catch(() => null)]);
		const positions = extractItems(res);
		const guildIconUrl = interaction.guild.iconURL({ extension: 'png', size: 256 });

		const container = buildPositionsListV2({
			guildId: interaction.guild.id,
			guildName: interaction.guild.name,
			guildIconUrl,
			positions,
			accent,
			page: 0,
		});

		return interaction.util.reply({
			components: [container],
			display: true,
			ephemeral: true,
		});
	}
}
