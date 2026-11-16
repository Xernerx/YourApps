/** @format */

import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getAppUrl } from '../../lib/endpoints.js';
import { ensureGuildProfile, resolveUserAccent } from '../../lib/guildSync.js';

export default class SetupCommand extends SlashCommandBuilder {
	constructor() {
		super('setup', {
			name: 'setup',
			description: 'Configure YourApps for your server with the Xernerx Dashboard.',
			defer: false,
			permissions: {
				user: ['ManageGuild'],
			},
		});
	}

	override async exec({ interaction }: SlashCommandOptions) {
		if (!interaction.deferred && !interaction.replied) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}

		const ws = (this.client as any).websocket;
		const guildId = interaction.guild?.id;

		// Check if the guild has a YourApps profile; create it if missing to mitigate pre-existing servers
		const [, accent] = await Promise.all([interaction.guild ? ensureGuildProfile(ws, interaction.guild).catch(() => null) : Promise.resolve(null), resolveUserAccent(ws, interaction.user.id)]);
		const appUrl = getAppUrl();
		const url = guildId ? `${appUrl}/dashboard?tab=applications&guild=${guildId}` : `${appUrl}/dashboard`;
		const botUser = interaction.client.user;
		const botAvatar = botUser?.displayAvatarURL({ extension: 'png', size: 256 }) || null;
		const guildIcon = interaction.guild?.iconURL({ extension: 'png', size: 256 }) || botAvatar;

		const embed = new EmbedBuilder()
			.setColor(accent)
			.setAuthor({
				name: `${botUser?.username || 'YourApps'} • Server Setup`,
				url,
				...(botAvatar ? { iconURL: botAvatar } : {}),
			})
			.setDescription(
				`Configure **${interaction.guild?.name || 'your server'}**'s application forms, questions, eligibility rules, review channels, and Apply panels directly on the **Xernerx Dashboard**.`
			)
			.setFooter({
				text: `${botUser?.username || 'YourApps'}`,
				...(botAvatar ? { iconURL: botAvatar } : {}),
			})
			.setTimestamp();

		if (guildIcon) {
			embed.setThumbnail(guildIcon);
		}

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel('Open Dashboard').setURL(url).setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel('Support').setURL('https://www.xernerx.com/support').setStyle(ButtonStyle.Link)
		);

		return interaction.util.reply({
			embeds: [embed],
			components: [row],
			ephemeral: true,
		});
	}
}
