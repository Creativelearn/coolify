import { dev } from '$app/env';
import { getDomain, getUserDetails } from '$lib/common';
import * as db from '$lib/database';
import { listSettings, ErrorHandler } from '$lib/database';
import {
	checkContainer,
	configureCoolifyProxyOff,
	configureCoolifyProxyOn,
	forceSSLOffApplication,
	forceSSLOnApplication,
	reloadHaproxy,
	removeWwwRedirection,
	setWwwRedirection,
	startCoolifyProxy
} from '$lib/haproxy';
import { letsEncrypt } from '$lib/letsencrypt';
import type { RequestHandler } from '@sveltejs/kit';

export const get: RequestHandler = async (event) => {
	const { status, body } = await getUserDetails(event);
	if (status === 401) return { status, body };

	try {
		const settings = await listSettings();
		return {
			status: 200,
			body: {
				settings
			}
		};
	} catch (error) {
		return ErrorHandler(error);
	}
};

export const del: RequestHandler = async (event) => {
	const { teamId, status, body } = await getUserDetails(event);
	if (teamId !== '0')
		return {
			status: 401,
			body: {
				message: 'You do not have permission to do this. \nAsk an admin to modify your permissions.'
			}
		};
	if (status === 401) return { status, body };

	const { fqdn } = await event.request.json();

	try {
		const domain = getDomain(fqdn);
		await db.prisma.setting.update({ where: { fqdn }, data: { fqdn: null } });
		await configureCoolifyProxyOff(fqdn);
		await removeWwwRedirection(domain);
		return {
			status: 201
		};
	} catch (error) {
		return ErrorHandler(error);
	}
};
export const post: RequestHandler = async (event) => {
	const { teamId, status, body } = await getUserDetails(event);
	if (teamId !== '0')
		return {
			status: 401,
			body: {
				message: 'You do not have permission to do this. \nAsk an admin to modify your permissions.'
			}
		};
	if (status === 401) return { status, body };

	const { fqdn, isRegistrationEnabled } = await event.request.json();
	try {
		const {
			id,
			fqdn: oldFqdn,
			isRegistrationEnabled: oldIsRegistrationEnabled
		} = await db.listSettings();
		if (oldIsRegistrationEnabled !== isRegistrationEnabled) {
			await db.prisma.setting.update({ where: { id }, data: { isRegistrationEnabled } });
		}
		if (oldFqdn && oldFqdn !== fqdn) {
			if (oldFqdn) {
				const oldDomain = getDomain(oldFqdn);
				await configureCoolifyProxyOff(oldFqdn);
				await removeWwwRedirection(oldDomain);
			}
		}
		if (fqdn) {
			await startCoolifyProxy('/var/run/docker.sock');
			const domain = getDomain(fqdn);
			const isHttps = fqdn.startsWith('https://');
			if (domain) {
				await configureCoolifyProxyOn(fqdn);
				await setWwwRedirection(fqdn);
				if (isHttps && !dev) {
					await letsEncrypt({ domain, isCoolify: true });
					await forceSSLOnApplication({ domain });
					await reloadHaproxy('/var/run/docker.sock');
				}
			}

			await db.prisma.setting.update({ where: { id }, data: { fqdn } });
			await db.prisma.destinationDocker.updateMany({
				where: { engine: '/var/run/docker.sock' },
				data: { isCoolifyProxyUsed: true }
			});
		}

		return {
			status: 201
		};
	} catch (error) {
		return ErrorHandler(error);
	}
};
