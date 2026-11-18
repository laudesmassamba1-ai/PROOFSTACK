/**
 * Where the session lives on disk.
 *
 * Two layers, because the threat is different from the one a browser faces: another process
 * running as the same user can read files, so a plaintext token on disk is a token that any
 * script gets for free. Electron's `safeStorage` puts the key in the OS vault (DPAPI on
 * Windows, Keychain on macOS, libsecret/kwallet on Linux), and this module only ever writes
 * the ciphertext.
 *
 * When the vault is unavailable - a Linux box with no keyring daemon, which is common on a
 * minimal install - the file still exists, but at mode 0600 and with a mode marker, so the
 * status line can say "not in the vault" instead of implying a protection that is not there.
 *
 * The format is one byte of header plus the payload: 0x01 sealed by the OS, 0x00 plain.
 */

const {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { join } = require("node:path");

const SEALED = 0x01;
const PLAIN = 0x00;

/**
 * @param {object} options
 * @param {string} options.dir       the app's user data directory
 * @param {object|null} options.safeStorage  Electron's safeStorage, or null in tests
 */
function createStore(options) {
  const file = join(options.dir, "session.bin");
  const safeStorage = options.safeStorage ?? null;

  const vaultAvailable = () => {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  };

  const ensureDir = () => {
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  };

  return {
    file,

    /** "keyring" when the OS vault is in use, "file" when it is not. */
    get mode() {
      return vaultAvailable() ? "keyring" : "file";
    },

    save(session) {
      ensureDir();
      const text = JSON.stringify(session);
      let header = PLAIN;
      let payload = Buffer.from(text, "utf8");
      if (vaultAvailable()) {
        payload = safeStorage.encryptString(text);
        header = SEALED;
      }
      // Write then rename: a crash mid-write must not leave a truncated token that looks
      // like a corrupted login and forces the user to sign in again for no reason.
      const temporary = `${file}.tmp-${process.pid}`;
      writeFileSync(temporary, Buffer.concat([Buffer.from([header]), payload]), { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, file);
      chmodSync(file, 0o600);
      return { mode: header === SEALED ? "keyring" : "file" };
    },

    load() {
      try {
        if (!existsSync(file)) return null;
        const bytes = readFileSync(file);
        if (bytes.length < 1) return null;
        const header = bytes[0];
        const body = bytes.subarray(1);
        if (header === SEALED) {
          if (!vaultAvailable()) {
            // The vault is there but locked (another session, a keyring that was reset):
            // reporting "no session" would be a lie, but guessing is worse than a re-login.
            return { error: "vault-locked" };
          }
          return JSON.parse(safeStorage.decryptString(body));
        }
        return JSON.parse(body.toString("utf8"));
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },

    clear() {
      rmSync(file, { force: true });
    },
  };
}

module.exports = { createStore };
