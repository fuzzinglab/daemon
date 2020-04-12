import dbus from "dbus-next"
import { spawn } from "child_process"
import readline from "readline"

function systemdProperties(properties) {
	// https://dbus.freedesktop.org/doc/dbus-specification.html#idm487
	// https://github.com/coreos/go-systemd/blob/master/dbus/properties.go
	const types = {
		ExecStart: "a(sasb)", // See ExecStartValue
		RemainAfterExit: "b",
		Type: "s",
		Description: "s",
		Requires: "as",
		RequiresOverridable: "as",
		Requisite: "as",
		Wants: "as",
		BindsTo: "as",
		RequiredBy: "as",
		RequiredByOverridable: "as",
		WantedBy: "as",
		BoundBy: "as",
		Conflicts: "as",
		ConflictedBy: "as",
		Before: "as",
		After: "as",
		OnFailure: "as",
		Triggers: "as",
		TriggeredBy: "as",
		PropagatesReloadTo: "as",
		RequiresMountsFor: "as",
		Slice: "s",
		PIDs: "ai",
		Environment: "as",
	};
	
	return Object.entries(properties)
		.map(([key, value]) => {
			if (!(key in types)) throw new Error(`Unsupported key ${key}`)
			return [key, new dbus.Variant(types[key], value)];
		})
}

// ExecStart is an array of ExecStartValue
function ExecStartValue({ argv, argv0 = argv[0], uncleanIsFailure = false }) {
	return [argv0, argv, uncleanIsFailure]
}

class SystemdJob {
	constructor(unit, unitName) {
		this.unit = unit
		this.unitName = unitName
	}

	async *logs() {
		const process = spawn("journalctl", ['-u', this.unitName, '-f', '-o', 'json'])

		try {
			const rl = readline.createInterface({ input: process.stdout })

			for await (const line of rl) {
				const {
					MESSAGE
				} = JSON.parse(line)
				yield MESSAGE
			}
		} finally {
			process.kill()
		}
	}
}

class Systemd {
	constructor(systemd) {
		this.systemd = systemd
	}

	async startJob(name, argv, { env }) {
		const manager = this.systemd.getInterface('org.freedesktop.systemd1.Manager')

		const unit = `${name}.service`
		await manager.StartTransientUnit(unit, "fail", systemdProperties({
			ExecStart: [
				ExecStartValue({ argv })
			],
			RemainAfterExit: true,
			Environment: Object.entries(env).map(([key, value]) => `${key}=${value}`)
		}), [])

		const unitPath = await manager.GetUnit(unit);

		return new SystemdJob(
			await this.systemd.bus.getProxyObject('org.freedesktop.systemd1', unitPath),
			unit
		)
	}

	static async create() {
		const bus = dbus.systemBus();
		const systemd = await bus.getProxyObject('org.freedesktop.systemd1', '/org/freedesktop/systemd1');

		return new Systemd(systemd);
	}
}

void async function main() {
	const systemd = await Systemd.create();

	const job = await systemd.startJob("test-23", ["/bin/sh", "-c", "while true; do echo lol; sleep 1; done"], {
		env: process.env
	})

	for await(const line of job.logs()) {
		console.log(line)
	}
}()