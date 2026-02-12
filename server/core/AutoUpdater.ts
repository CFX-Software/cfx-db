import { spawn } from "child_process";
import { existsSync } from "fs";
import { Logger } from "../utils/Logger";

type UpdateMode = "notify" | "patch" | "minor" | "major";
type UpdateLevel = "none" | "patch" | "minor" | "major" | "unknown";
type VersionSource = "github" | "git" | "hybrid";
type UpdateSource = "github-releases" | "git-tags" | "none";

interface CommandResult {
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    error: string | null;
}

interface ReleaseSummary {
    version: string;
    tag: string;
    name: string;
    notes: string;
    url: string | null;
    publishedAt: string | null;
    source: UpdateSource;
}

interface GitEnvironment {
    gitAvailable: boolean;
    isGitRepo: boolean;
    branch: string | null;
    cleanWorkTree: boolean | null;
    fetchError: string | null;
    latestGitTagVersion: string | null;
}

interface GitHubReleasePayload {
    tag_name?: unknown;
    name?: unknown;
    body?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    draft?: unknown;
    prerelease?: unknown;
}

export interface AutoUpdaterSettings {
    enabled: boolean;
    mode: UpdateMode;
    versionSource: VersionSource;
    checkIntervalMinutes: number;
    remote: string;
    branch: string;
    restartOnUpdate: boolean;
    requireCleanWorkTree: boolean;
    fetchTags: boolean;
    includePrerelease: boolean;
    notifyOnUpToDate: boolean;
    githubReleasesApiUrl: string;
    commandTimeoutMs: number;
}

export interface VersionStatus {
    runtimeVersion: string;
    localVersionTag: string | null;
    latestVersionTag: string | null;
    latestReleaseName: string | null;
    latestReleaseUrl: string | null;
    latestReleasePublishedAt: string | null;
    updateAvailable: boolean;
    updateLevel: UpdateLevel;
    updateSource: UpdateSource;
    gitAvailable: boolean;
    isGitRepo: boolean;
    branch: string | null;
    cleanWorkTree: boolean | null;
    enabled: boolean;
    mode: UpdateMode;
    deprecationsDetected: boolean;
    deprecationWarnings: string[];
    breakingChangeDetected: boolean;
    lastCheckAt: number | null;
    lastError: string | null;
    lastFetchError: string | null;
}

export interface UpdateApplyResult {
    success: boolean;
    message: string;
    status: VersionStatus;
    pulled: boolean;
    restartIssued: boolean;
}

interface AutoUpdaterInit {
    resourceName: string;
    resourcePath: string;
    runtimeVersion: string;
}

const DEFAULT_SETTINGS: AutoUpdaterSettings = {
    enabled: false,
    mode: "notify",
    versionSource: "hybrid",
    checkIntervalMinutes: 30,
    remote: "origin",
    branch: "main",
    restartOnUpdate: false,
    requireCleanWorkTree: true,
    fetchTags: true,
    includePrerelease: false,
    notifyOnUpToDate: true,
    githubReleasesApiUrl: "https://api.github.com/repos/CFX-Software/cfx-db/releases",
    commandTimeoutMs: 10000,
};

const DEPRECATION_KEYWORDS = [
    /deprecat/i,
    /breaking/i,
    /removed?/i,
    /migration/i,
    /incompatib/i,
];

function parseSemver(input: string): { major: number; minor: number; patch: number } | null {
    const clean = input.trim().replace(/^v/i, "");
    const match = clean.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
        return null;
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

function compareSemver(a: string, b: string): number {
    const aParsed = parseSemver(a);
    const bParsed = parseSemver(b);

    if (!aParsed || !bParsed) {
        return a.localeCompare(b);
    }

    if (aParsed.major !== bParsed.major) {
        return aParsed.major - bParsed.major;
    }
    if (aParsed.minor !== bParsed.minor) {
        return aParsed.minor - bParsed.minor;
    }
    return aParsed.patch - bParsed.patch;
}

function getUpdateLevel(currentVersion: string, latestVersion: string): UpdateLevel {
    const current = parseSemver(currentVersion);
    const latest = parseSemver(latestVersion);

    if (!current || !latest) {
        return currentVersion === latestVersion ? "none" : "unknown";
    }

    if (
        current.major === latest.major &&
        current.minor === latest.minor &&
        current.patch === latest.patch
    ) {
        return "none";
    }

    if (latest.major > current.major) {
        return "major";
    }
    if (latest.minor > current.minor) {
        return "minor";
    }
    if (latest.patch > current.patch) {
        return "patch";
    }
    return "none";
}

function stripVersionPrefix(version: string): string {
    return version.trim().replace(/^v/i, "");
}

function isValidMode(value: unknown): value is UpdateMode {
    return value === "notify" || value === "patch" || value === "minor" || value === "major";
}

function isValidVersionSource(value: unknown): value is VersionSource {
    return value === "github" || value === "git" || value === "hybrid";
}

function sanitizeReleaseUrl(url: string): string {
    return url.trim().replace(/\/+$/, "");
}

function readString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

export class AutoUpdater {
    private static instance: AutoUpdater | null = null;

    static getInstance(init?: AutoUpdaterInit): AutoUpdater {
        if (!AutoUpdater.instance) {
            if (!init) {
                throw new Error("AutoUpdater not initialized");
            }
            AutoUpdater.instance = new AutoUpdater(init);
        }
        return AutoUpdater.instance;
    }

    private settings: AutoUpdaterSettings = { ...DEFAULT_SETTINGS };
    private readonly resourceName: string;
    private readonly resourcePath: string;
    private readonly runtimeVersion: string;
    private readonly log = Logger.getInstance().scoped("updater");
    private timerId: ReturnType<typeof setInterval> | null = null;
    private isChecking = false;
    private isApplying = false;
    private lastNotifiedVersion: string | null = null;
    private lastStatusSignature: string | null = null;

    private status: VersionStatus;

    private constructor(init: AutoUpdaterInit) {
        this.resourceName = init.resourceName;
        this.resourcePath = init.resourcePath;
        this.runtimeVersion = stripVersionPrefix(init.runtimeVersion);
        this.status = {
            runtimeVersion: this.runtimeVersion,
            localVersionTag: `v${this.runtimeVersion}`,
            latestVersionTag: null,
            latestReleaseName: null,
            latestReleaseUrl: null,
            latestReleasePublishedAt: null,
            updateAvailable: false,
            updateLevel: "none",
            updateSource: "none",
            gitAvailable: false,
            isGitRepo: false,
            branch: null,
            cleanWorkTree: null,
            enabled: this.settings.enabled,
            mode: this.settings.mode,
            deprecationsDetected: false,
            deprecationWarnings: [],
            breakingChangeDetected: false,
            lastCheckAt: null,
            lastError: null,
            lastFetchError: null,
        };
    }

    configure(overrides?: Partial<AutoUpdaterSettings>): void {
        if (!overrides) {
            return;
        }

        const merged: AutoUpdaterSettings = {
            ...this.settings,
            ...overrides,
        };

        if (!isValidMode(merged.mode)) {
            merged.mode = "notify";
        }

        if (!isValidVersionSource(merged.versionSource)) {
            merged.versionSource = "hybrid";
        }

        merged.checkIntervalMinutes = Math.max(1, Math.floor(merged.checkIntervalMinutes));
        merged.commandTimeoutMs = Math.max(1000, Math.floor(merged.commandTimeoutMs));
        merged.githubReleasesApiUrl = sanitizeReleaseUrl(merged.githubReleasesApiUrl);

        this.settings = merged;
        this.status.enabled = merged.enabled;
        this.status.mode = merged.mode;
    }

    start(): void {
        this.stop();

        void this.checkForUpdates({ manual: false, fetch: true });

        if (!this.settings.enabled) {
            this.log.debug("Auto-updater disabled");
            return;
        }

        const intervalMs = this.settings.checkIntervalMinutes * 60 * 1000;
        this.timerId = setInterval(() => {
            void this.checkForUpdates({ manual: false, fetch: true });
        }, intervalMs);

        this.log.info("Auto-updater started", {
            mode: this.settings.mode,
            source: this.settings.versionSource,
            intervalMinutes: this.settings.checkIntervalMinutes,
            remote: this.settings.remote,
            branch: this.settings.branch,
        });
    }

    stop(): void {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    getStatus(): VersionStatus {
        return {
            ...this.status,
            deprecationWarnings: [...this.status.deprecationWarnings],
        };
    }

    async checkForUpdates(options?: {
        manual?: boolean;
        fetch?: boolean;
    }): Promise<VersionStatus> {
        if (this.isChecking) {
            return this.getStatus();
        }

        this.isChecking = true;
        const manual = options?.manual === true;
        const shouldFetch = options?.fetch !== false;

        try {
            const gitEnv = await this.inspectGitEnvironment(shouldFetch);
            const githubResult = await this.fetchGitHubReleases();
            const selectedRelease = this.selectReleaseSource(
                githubResult.releases,
                gitEnv.latestGitTagVersion
            );

            const status: VersionStatus = {
                ...this.status,
                runtimeVersion: this.runtimeVersion,
                localVersionTag: `v${this.runtimeVersion}`,
                latestVersionTag: selectedRelease ? selectedRelease.tag : null,
                latestReleaseName: selectedRelease ? selectedRelease.name : null,
                latestReleaseUrl: selectedRelease ? selectedRelease.url : null,
                latestReleasePublishedAt: selectedRelease ? selectedRelease.publishedAt : null,
                updateSource: selectedRelease ? selectedRelease.source : "none",
                updateAvailable:
                    selectedRelease !== null &&
                    compareSemver(selectedRelease.version, this.runtimeVersion) > 0,
                updateLevel:
                    selectedRelease !== null
                        ? getUpdateLevel(this.runtimeVersion, selectedRelease.version)
                        : "none",
                gitAvailable: gitEnv.gitAvailable,
                isGitRepo: gitEnv.isGitRepo,
                branch: gitEnv.branch,
                cleanWorkTree: gitEnv.cleanWorkTree,
                enabled: this.settings.enabled,
                mode: this.settings.mode,
                deprecationsDetected: false,
                deprecationWarnings: [],
                breakingChangeDetected: false,
                lastCheckAt: Date.now(),
                lastError: !githubResult.ok && this.settings.versionSource !== "git"
                    ? githubResult.error
                    : null,
                lastFetchError: githubResult.error || gitEnv.fetchError,
            };

            if (status.updateAvailable && selectedRelease) {
                const warnings = this.extractDeprecationWarnings(
                    githubResult.releases,
                    this.runtimeVersion,
                    selectedRelease.version
                );
                status.deprecationsDetected = warnings.length > 0;
                status.deprecationWarnings = warnings;
                status.breakingChangeDetected = status.updateLevel === "major" || warnings.length > 0;
            }

            const statusSignature = [
                status.updateAvailable ? "OUTDATED" : "UP_TO_DATE",
                status.localVersionTag,
                status.latestVersionTag,
                status.updateSource,
                status.updateLevel,
                status.deprecationsDetected ? "dep" : "clean",
            ].join("|");

            const shouldLogStatus =
                manual ||
                this.settings.notifyOnUpToDate ||
                this.lastStatusSignature !== statusSignature;

            if (status.updateAvailable && selectedRelease) {
                if (shouldLogStatus) {
                    this.log.warn("OUTDATED", {
                        current: `v${this.runtimeVersion}`,
                        latest: selectedRelease.tag,
                        level: status.updateLevel,
                        source: status.updateSource,
                        url: selectedRelease.url,
                    });
                }

                if (
                    this.lastNotifiedVersion !== selectedRelease.version ||
                    manual ||
                    this.lastStatusSignature !== statusSignature
                ) {
                    this.lastNotifiedVersion = selectedRelease.version;

                    if (status.updateLevel === "major") {
                        this.log.warn("MAJOR UPDATE", {
                            current: `v${this.runtimeVersion}`,
                            latest: selectedRelease.tag,
                            requiresReview: true,
                        });
                    }

                    if (status.deprecationsDetected) {
                        this.log.warn("DEPRECATION WARNING", {
                            warnings: status.deprecationWarnings.slice(0, 3),
                        });
                    }
                }
            } else if (shouldLogStatus) {
                this.log.info("UP_TO_DATE", {
                    current: `v${this.runtimeVersion}`,
                    latest: status.latestVersionTag || `v${this.runtimeVersion}`,
                    source: status.updateSource,
                });
            }

            this.lastStatusSignature = statusSignature;

            this.status = status;
            emit("cfxdb:update:status", this.getStatus());

            if (
                !manual &&
                this.settings.enabled &&
                status.updateAvailable &&
                this.shouldAutoApply(status.updateLevel) &&
                !(status.updateLevel === "major" && status.deprecationsDetected)
            ) {
                void this.applyUpdate({ force: false, skipCheck: true });
            }

            if (!gitEnv.gitAvailable && (this.settings.enabled || manual)) {
                this.log.warn("Git is not available; auto-apply cannot run", {
                    versionCheckSource: status.updateSource,
                });
            }

            return this.getStatus();
        } catch (error) {
            this.status = {
                ...this.status,
                lastCheckAt: Date.now(),
                lastError: error instanceof Error ? error.message : String(error),
            };
            return this.getStatus();
        } finally {
            this.isChecking = false;
        }
    }

    async applyUpdate(options?: {
        force?: boolean;
        skipCheck?: boolean;
    }): Promise<UpdateApplyResult> {
        if (this.isApplying) {
            return {
                success: false,
                message: "Update already in progress",
                status: this.getStatus(),
                pulled: false,
                restartIssued: false,
            };
        }

        this.isApplying = true;

        try {
            const force = options?.force === true;
            const status = options?.skipCheck
                ? this.getStatus()
                : await this.checkForUpdates({ manual: true, fetch: true });

            if (!status.gitAvailable) {
                return {
                    success: false,
                    message: "Git is not available on this machine",
                    status,
                    pulled: false,
                    restartIssued: false,
                };
            }

            if (!status.isGitRepo) {
                return {
                    success: false,
                    message: "Resource is not running from a git repository",
                    status,
                    pulled: false,
                    restartIssued: false,
                };
            }

            if (!status.updateAvailable) {
                return {
                    success: true,
                    message: "Already up to date",
                    status,
                    pulled: false,
                    restartIssued: false,
                };
            }

            if (this.settings.requireCleanWorkTree && status.cleanWorkTree === false) {
                return {
                    success: false,
                    message: "Update blocked: working tree is not clean",
                    status,
                    pulled: false,
                    restartIssued: false,
                };
            }

            if (!force && !this.isModeAllowed(status.updateLevel)) {
                return {
                    success: false,
                    message: `Update blocked by policy (mode=${this.settings.mode}, level=${status.updateLevel})`,
                    status,
                    pulled: false,
                    restartIssued: false,
                };
            }

            if (
                !force &&
                status.updateLevel === "major" &&
                (status.deprecationsDetected || status.breakingChangeDetected)
            ) {
                return {
                    success: false,
                    message:
                        "Major update with potential deprecations detected. Review release notes and re-run with force to apply.",
                    status,
                    pulled: false,
                    restartIssued: false,
                };
            }

            const targetBranch =
                status.branch && status.branch !== "HEAD" ? status.branch : this.settings.branch;

            const pullResult = await this.runCommand("git", [
                "pull",
                "--ff-only",
                this.settings.remote,
                targetBranch,
            ]);

            if (!pullResult.ok) {
                return {
                    success: false,
                    message: pullResult.error || pullResult.stderr || "git pull failed",
                    status,
                    pulled: false,
                    restartIssued: false,
                };
            }

            const refreshStatus = await this.checkForUpdates({ manual: true, fetch: false });
            const pulled = !/already up[ -]?to[ -]?date/i.test(
                `${pullResult.stdout}\n${pullResult.stderr}`
            );

            let restartIssued = false;
            if (pulled && this.settings.restartOnUpdate) {
                try {
                    ExecuteCommand("refresh");
                    ExecuteCommand(`restart ${this.resourceName}`);
                    restartIssued = true;
                } catch (error) {
                    this.log.warn("Failed to issue restart command", {
                        error: String(error),
                    });
                }
            }

            return {
                success: true,
                message: pulled
                    ? restartIssued
                        ? "Update applied and restart command issued"
                        : "Update applied (restart recommended)"
                    : "Already up to date",
                status: refreshStatus,
                pulled,
                restartIssued,
            };
        } finally {
            this.isApplying = false;
        }
    }

    private async inspectGitEnvironment(shouldFetch: boolean): Promise<GitEnvironment> {
        const gitVersion = await this.runCommand("git", ["--version"]);
        if (!gitVersion.ok) {
            return {
                gitAvailable: false,
                isGitRepo: false,
                branch: null,
                cleanWorkTree: null,
                fetchError: null,
                latestGitTagVersion: null,
            };
        }

        if (!existsSync(this.resourcePath)) {
            return {
                gitAvailable: true,
                isGitRepo: false,
                branch: null,
                cleanWorkTree: null,
                fetchError: "resource path does not exist",
                latestGitTagVersion: null,
            };
        }

        const repoCheck = await this.runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
        const isGitRepo = repoCheck.ok && repoCheck.stdout.trim() === "true";
        if (!isGitRepo) {
            return {
                gitAvailable: true,
                isGitRepo: false,
                branch: null,
                cleanWorkTree: null,
                fetchError: "resource is not a git repository",
                latestGitTagVersion: null,
            };
        }

        const branch = await this.runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
        const workTree = await this.runCommand("git", ["status", "--porcelain"]);

        let fetchError: string | null = null;
        if (shouldFetch && this.settings.fetchTags && this.settings.versionSource !== "github") {
            const fetchResult = await this.runCommand("git", [
                "fetch",
                this.settings.remote,
                "--tags",
                "--prune",
            ]);
            if (!fetchResult.ok) {
                fetchError = fetchResult.error || fetchResult.stderr || "git fetch failed";
            }
        }

        const latestTagVersion = await this.getLatestTag();

        return {
            gitAvailable: true,
            isGitRepo: true,
            branch: branch.ok ? branch.stdout.trim() : null,
            cleanWorkTree: workTree.ok ? workTree.stdout.trim() === "" : null,
            fetchError,
            latestGitTagVersion: latestTagVersion,
        };
    }

    private async fetchGitHubReleases(): Promise<{
        ok: boolean;
        releases: ReleaseSummary[];
        error: string | null;
    }> {
        if (this.settings.versionSource === "git") {
            return { ok: true, releases: [], error: null };
        }

        if (!this.settings.githubReleasesApiUrl) {
            return { ok: false, releases: [], error: "GitHub releases URL is empty" };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.settings.commandTimeoutMs);

        try {
            const headers: Record<string, string> = {
                "Accept": "application/vnd.github+json",
                "User-Agent": "cfx-db-auto-updater",
            };

            const token = process.env["CFXDB_GITHUB_TOKEN"] || process.env["GITHUB_TOKEN"];
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const response = await fetch(this.settings.githubReleasesApiUrl, {
                method: "GET",
                headers,
                signal: controller.signal,
            });

            if (!response.ok) {
                return {
                    ok: false,
                    releases: [],
                    error: `GitHub releases request failed (${response.status})`,
                };
            }

            const payload = (await response.json()) as unknown;
            const rawItems: GitHubReleasePayload[] = Array.isArray(payload)
                ? (payload as GitHubReleasePayload[])
                : payload && typeof payload === "object"
                    ? [payload as GitHubReleasePayload]
                    : [];

            const releases: ReleaseSummary[] = [];
            for (const item of rawItems) {
                const tagName = readString(item.tag_name);
                if (!tagName) {
                    continue;
                }

                const isDraft = Boolean(item.draft);
                const isPrerelease = Boolean(item.prerelease);
                if (isDraft) {
                    continue;
                }
                if (!this.settings.includePrerelease && isPrerelease) {
                    continue;
                }

                const version = stripVersionPrefix(tagName);
                if (!parseSemver(version)) {
                    continue;
                }

                releases.push({
                    version,
                    tag: tagName.startsWith("v") ? tagName : `v${version}`,
                    name: readString(item.name) || tagName,
                    notes: readString(item.body),
                    url: readString(item.html_url) || null,
                    publishedAt: readString(item.published_at) || null,
                    source: "github-releases",
                });
            }

            releases.sort((a, b) => compareSemver(b.version, a.version));
            return { ok: true, releases, error: null };
        } catch (error) {
            return {
                ok: false,
                releases: [],
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    private selectReleaseSource(
        githubReleases: ReleaseSummary[],
        latestGitTagVersion: string | null
    ): ReleaseSummary | null {
        const latestGithub = githubReleases.length > 0 ? githubReleases[0]! : null;

        if (this.settings.versionSource === "github") {
            return latestGithub;
        }

        if (this.settings.versionSource === "git") {
            return latestGitTagVersion
                ? {
                      version: latestGitTagVersion,
                      tag: `v${latestGitTagVersion}`,
                      name: `v${latestGitTagVersion}`,
                      notes: "",
                      url: null,
                      publishedAt: null,
                      source: "git-tags",
                  }
                : null;
        }

        if (latestGithub) {
            return latestGithub;
        }

        if (latestGitTagVersion) {
            return {
                version: latestGitTagVersion,
                tag: `v${latestGitTagVersion}`,
                name: `v${latestGitTagVersion}`,
                notes: "",
                url: null,
                publishedAt: null,
                source: "git-tags",
            };
        }

        return null;
    }

    private extractDeprecationWarnings(
        releases: ReleaseSummary[],
        currentVersion: string,
        latestVersion: string
    ): string[] {
        if (releases.length === 0) {
            return [];
        }

        const newer = releases.filter(
            (release) =>
                compareSemver(release.version, currentVersion) > 0 &&
                compareSemver(release.version, latestVersion) <= 0
        );

        const warnings: string[] = [];
        for (const release of newer) {
            const lines = release.notes
                .split(/\r?\n/g)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            for (const line of lines) {
                if (DEPRECATION_KEYWORDS.some((keyword) => keyword.test(line))) {
                    warnings.push(`${release.tag}: ${line.slice(0, 160)}`);
                }
                if (warnings.length >= 8) {
                    return warnings;
                }
            }
        }

        return warnings;
    }

    private shouldAutoApply(level: UpdateLevel): boolean {
        if (this.settings.mode === "notify") {
            return false;
        }
        return this.isModeAllowed(level);
    }

    private isModeAllowed(level: UpdateLevel): boolean {
        if (level === "none") {
            return true;
        }
        if (level === "unknown") {
            return false;
        }

        switch (this.settings.mode) {
            case "patch":
                return level === "patch";
            case "minor":
                return level === "patch" || level === "minor";
            case "major":
                return level === "patch" || level === "minor" || level === "major";
            case "notify":
            default:
                return false;
        }
    }

    private async getLatestTag(): Promise<string | null> {
        const tags = await this.runCommand("git", [
            "tag",
            "--list",
            "v*",
            "--sort=-version:refname",
        ]);

        if (!tags.ok) {
            return null;
        }

        const lines = tags.stdout
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter(Boolean);

        for (const tag of lines) {
            const clean = stripVersionPrefix(tag);
            if (parseSemver(clean)) {
                return clean;
            }
        }

        return null;
    }

    private runCommand(command: string, args: string[]): Promise<CommandResult> {
        return new Promise((resolve) => {
            const started = Date.now();
            let stdout = "";
            let stderr = "";
            let timedOut = false;
            let settled = false;

            const child = spawn(command, args, {
                cwd: this.resourcePath,
                windowsHide: true,
            });

            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, this.settings.commandTimeoutMs);

            child.stdout?.on("data", (chunk: Buffer | string) => {
                stdout += chunk.toString();
            });

            child.stderr?.on("data", (chunk: Buffer | string) => {
                stderr += chunk.toString();
            });

            child.once("error", (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve({
                    ok: false,
                    code: null,
                    stdout,
                    stderr,
                    timedOut,
                    durationMs: Date.now() - started,
                    error: error.message,
                });
            });

            child.once("close", (code) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve({
                    ok: code === 0 && !timedOut,
                    code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    timedOut,
                    durationMs: Date.now() - started,
                    error: null,
                });
            });
        });
    }
}
