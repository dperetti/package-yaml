#!/usr/bin/env node
"use strict";
/// <reference path="../types/yaml.d.ts" />
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yaml_1 = __importDefault(require("yaml"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const deep_diff_1 = require("deep-diff");
const npmlog_1 = __importDefault(require("npmlog"));
require("reflect-metadata");
const osenv_1 = __importDefault(require("osenv"));
const npm_autoloader_1 = require("npm-autoloader");
const pkg_dir_1 = __importDefault(require("pkg-dir"));
npmlog_1.default.heading = 'package-yaml';
if (!!process.env.DEBUG_PACKAGE_YAML) {
    npmlog_1.default.level = 'verbose';
}
const propertyClassesKey = Symbol("propertyClasses");
function property(target, propertyKey) {
    const propClasses = Reflect.getOwnMetadata(propertyClassesKey, target.constructor) || {};
    const propClass = Reflect.getMetadata('design:type', target, propertyKey);
    propClasses[propertyKey] = propClass;
    Reflect.defineMetadata(propertyClassesKey, propClasses, target.constructor);
}
function getPropClasses(target) {
    const classTarget = typeof target === "object" ? target.constructor : target;
    const classProperties = Reflect.getOwnMetadata(propertyClassesKey, classTarget) || {};
    return classProperties;
}
function getProps(target) {
    return Object.keys(getPropClasses(target));
}
function getPropClass(target, prop) {
    return getPropClasses(target)[prop];
}
function isPropClass(target, prop, cls) {
    const propClass = getPropClass(target, prop);
    return (propClass === cls);
}
var ConflictResolution;
(function (ConflictResolution) {
    ConflictResolution["ask"] = "ask";
    ConflictResolution["useJson"] = "use-json";
    ConflictResolution["useYaml"] = "use-yaml";
    ConflictResolution["useLatest"] = "use-latest";
})(ConflictResolution || (ConflictResolution = {}));
;
class Config {
    constructor(loadConfigFiles = true) {
        this.debug = false;
        this.writeBackups = true;
        this.backupPath = ".%s~"; // %s - basename; %S - full path with % interpolations
        this.timestampFuzz = 5;
        this.conflicts = ConflictResolution.ask;
        this.tryMerge = true; // Only functions when backups are being written
        this.defaultExtension = "yaml";
        this._lockedProps = {};
        if (!!process.env.DEBUG_PACKAGE_YAML) {
            this.updateAndLock({ debug: true });
        }
        if (process.env.PACKAGE_YAML_FORCE) {
            const confl = `use-${process.env.PACKAGE_YAML_FORCE}`;
            if (Config.isValid("conflicts", confl)) {
                this.updateAndLock({ conflicts: confl });
            }
        }
        if (loadConfigFiles) {
            this.loadSystemConfig();
        }
    }
    loadSystemConfig() {
        for (let globalPath of ['/etc', '/usr/local/etc']) {
            // FIXME: this won't work on Windows
            this.loadConfigFile(path_1.default.join(globalPath, "package-yaml.json"));
            this.loadConfigFile(path_1.default.join(globalPath, "package-yaml.yaml"));
        }
        const home = osenv_1.default.home();
        this.loadConfigFile(path_1.default.join(home, ".package-yaml.json"));
        this.loadConfigFile(path_1.default.join(home, ".package-yaml.yaml"));
    }
    static isValid(prop, value) {
        npmlog_1.default.verbose("Config.isValid", "checking %s: %s", prop, value);
        if (prop === "conflicts") {
            npmlog_1.default.verbose("Config.isValid", "ovcfr: %o; includes: %s", Object.values(ConflictResolution), Object.values(ConflictResolution).includes(value));
            return typeof value === 'string' && (Object.values(ConflictResolution).includes(value));
        }
        else if (prop === "defaultExtension") {
            return value === 'yaml' || value === 'yml';
        }
        else if (isPropClass(Config, prop, String)) {
            return typeof value === 'string';
        }
        else if (isPropClass(Config, prop, Boolean)) {
            return true; // anything can be a Boolean if you just believe
        }
        else if (isPropClass(Config, prop, Number)) {
            return !isNaN(Number(value));
        }
        return false;
    }
    validate(values) {
        const valid = {};
        const propNames = getProps(Config);
        for (const prop of propNames) {
            const val = values[prop];
            if (this._lockedProps[prop] || !(prop in values) || !Config.isValid(prop, val)) {
                continue;
            }
            if (isPropClass(Config, prop, String)) {
                valid[prop] = String(values[prop]); // We've already validated these
            }
            else if (isPropClass(Config, prop, Boolean)) {
                valid[prop] = !!values[prop];
            }
            else if (isPropClass(Config, prop, Number)) {
                valid[prop] = Number(values[prop]);
            }
        }
        return valid;
    }
    update(values) {
        const valid = this.validate(values);
        Object.assign(this, valid);
        if ('debug' in valid) {
            npmlog_1.default.level = valid.debug ? 'verbose' : 'info';
        }
        return valid;
    }
    lock(props) {
        for (let prop of props) {
            if (prop in this) {
                this._lockedProps[prop] = true;
            }
        }
    }
    updateAndLock(values) {
        const updated = this.update(values);
        this.lock(Object.keys(updated));
        return updated;
    }
    loadConfigFile(path, rootElement) {
        let configData;
        let configParsed;
        try {
            if (!fs_1.default.existsSync(path)) {
                return null;
            }
            configData = fs_1.default.readFileSync(path, { encoding: "utf8" });
        }
        catch (e) {
            npmlog_1.default.error("loadConfig", "Error loading config file %s: %s", path, e);
            return null;
        }
        try {
            // YAML parsing *should* work for JSON files without issue
            configParsed = yaml_1.default.parse(configData);
        }
        catch (yamlError) {
            // try using JSON as a backup
            try {
                configParsed = JSON.parse(configData);
            }
            catch (jsonError) {
                const error = path.endsWith(".json") ? jsonError : yamlError;
                npmlog_1.default.error("loadConfig", "Error parsing YAML/JSON config file %s: %s", path, error);
                return null;
            }
        }
        if (rootElement) {
            if (!configParsed || typeof configParsed !== "object" || !configParsed[rootElement]) {
                // Acceptable, just like if the file didn't exist
                return null;
            }
            configParsed = configParsed[rootElement];
        }
        if (!configParsed || typeof configParsed !== "object") {
            if (rootElement) {
                npmlog_1.default.error("loadConfig", "Invalid configuration stanza %s in %s (should be an object)", rootElement, path);
            }
            else {
                npmlog_1.default.error("loadConfig", "Invalid configuration file %s (should be a JSON/YAML object)", path);
            }
            return null;
        }
        return this.update(configParsed);
    }
}
__decorate([
    property,
    __metadata("design:type", Boolean)
], Config.prototype, "debug", void 0);
__decorate([
    property,
    __metadata("design:type", Boolean)
], Config.prototype, "writeBackups", void 0);
__decorate([
    property,
    __metadata("design:type", String)
], Config.prototype, "backupPath", void 0);
__decorate([
    property,
    __metadata("design:type", Number)
], Config.prototype, "timestampFuzz", void 0);
__decorate([
    property,
    __metadata("design:type", String)
], Config.prototype, "conflicts", void 0);
__decorate([
    property,
    __metadata("design:type", Boolean)
], Config.prototype, "tryMerge", void 0);
__decorate([
    property,
    __metadata("design:type", String)
], Config.prototype, "defaultExtension", void 0);
;
function loadAndParse(path, parser, inhibitErrors = false) {
    try {
        const data = fs_1.default.readFileSync(path, { encoding: "utf8" });
        return parser(data);
    }
    catch (e) {
        if (inhibitErrors) {
            return null;
        }
        throw e;
    }
}
class Project {
    constructor(projectDir) {
        this.config = new Config();
        this.yamlModified = false;
        this.jsonModified = false;
        this.projectDir = projectDir;
        this.yamlExtension =
            fs_1.default.existsSync(this.projectPath('package.yaml')) ? 'yaml' :
                fs_1.default.existsSync(this.projectPath('package.yml')) ? 'yml' :
                    null;
        this.config.loadConfigFile(this.projectPath("package-yaml.json"));
        this.config.loadConfigFile(this.projectPath("package-yaml.yaml"));
        this.config.loadConfigFile(this.jsonPath, "package-yaml");
        this.config.loadConfigFile(this.yamlPath, "package-yaml");
        this.jsonExists = fs_1.default.existsSync(this.jsonPath);
        this.yamlExists = fs_1.default.existsSync(this.yamlPath);
    }
    get jsonName() {
        return "package.json";
    }
    get yamlName() {
        return `package.${this.yamlExtension || this.config.defaultExtension}`;
    }
    projectPath(localPath) {
        return path_1.default.join(this.projectDir, localPath);
    }
    get jsonPath() {
        return this.projectPath(this.jsonName);
    }
    get yamlPath() {
        return this.projectPath(this.yamlName);
    }
    get jsonContents() {
        if (this._jsonContents)
            return this._jsonContents;
        if (this.jsonExists) {
            try {
                return this._jsonContents = loadAndParse(this.jsonPath, JSON.parse);
            }
            catch (e) {
                npmlog_1.default.error("loadJson", "Cannot load or parse %s: %s", this.jsonPath, e);
                throw e;
            }
        }
        else {
            return this._jsonContents = {};
        }
    }
    set jsonContents(value) {
        if (deep_diff_1.diff(this._jsonContents, value)) {
            this.jsonModified = true;
        }
        this._jsonContents = value;
    }
    get yamlDocument() {
        if (this._yamlDocument)
            return this._yamlDocument;
        if (this.yamlExists) {
            try {
                return this._yamlDocument = loadAndParse(this.yamlPath, yaml_1.default.parseDocument);
            }
            catch (e) {
                npmlog_1.default.error("loadYaml", "Cannot load or parse %s: %s", this.yamlPath, e);
                throw e;
            }
        }
        else {
            return this._yamlDocument = new yaml_1.default.Document();
        }
    }
    set yamlDocument(value) {
        if (this._yamlDocument !== value) {
            this.yamlModified = true;
        }
        this._yamlDocument = value;
    }
    get yamlContents() {
        return this.yamlDocument.toJSON();
    }
    backupPath(filename) {
        const fullPath = this.projectPath(filename).replace(/\//g, '%');
        const backupPath = this.config.backupPath
            .replace("%s", filename)
            .replace("%S", fullPath);
        return path_1.default.resolve(this.projectDir, backupPath);
    }
    writeBackups() {
        let success = true;
        if (!this.config.writeBackups)
            return success;
        try {
            fs_1.default.writeFileSync(this.backupPath(this.jsonName), JSON.stringify(this.jsonContents, null, 4));
        }
        catch (e) {
            success = false;
            npmlog_1.default.warn("writeBackups", "Error writing backup package.json file at %s: %s", this.backupPath(this.jsonName), e);
        }
        try {
            fs_1.default.writeFileSync(this.backupPath(this.yamlName), this.yamlDocument.toString());
        }
        catch (e) {
            success = false;
            npmlog_1.default.warn("writeBackups", "Error writing backup %s file at %s: %s", this.yamlName, this.backupPath(this.yamlName), e);
        }
        return success;
    }
    writePackageFiles() {
        let success = true;
        if (this.yamlModified) {
            try {
                fs_1.default.writeFileSync(this.yamlPath, this.yamlDocument.toString());
                this.yamlModified = false;
            }
            catch (e) {
                success = false;
                npmlog_1.default.error("writePackageFiles", "Error writing %s: %s", this.yamlPath, e);
            }
        }
        if (this.jsonModified) {
            try {
                fs_1.default.writeFileSync(this.jsonPath, JSON.stringify(this.jsonContents, null, 4));
                this.jsonModified = false;
            }
            catch (e) {
                success = false;
                npmlog_1.default.error("writePackageFiles", "Error writing %s: %s", this.jsonPath, e);
            }
        }
        return success;
    }
    patchYaml(diff) {
        if (diff) {
            this.yamlDocument = patchYamlDocument(this.yamlDocument, diff);
            this.yamlModified = true;
        }
        return this.yamlDocument;
    }
    patchJson(diff) {
        if (diff) {
            this.jsonContents = patchObject(this.jsonContents, diff);
            this.jsonModified = true;
        }
        return this.jsonContents;
    }
    sync(conflictStrategy) {
        conflictStrategy = conflictStrategy || this.config.conflicts;
        if (!deep_diff_1.diff(this.jsonContents, this.yamlContents)) {
            npmlog_1.default.verbose("sync", "Package files already in sync, writing backups");
            this.writeBackups();
            return true;
        }
        npmlog_1.default.verbose("sync", "Package files out of sync. Trying to resolve...");
        if (!this.yamlExists) {
            npmlog_1.default.verbose("sync", `${this.yamlName} does not exist, creating from package.json`);
            conflictStrategy = ConflictResolution.useJson;
        }
        else if (!this.jsonExists) {
            npmlog_1.default.verbose("sync", `package.json does not exist, using ${this.yamlName}`);
            conflictStrategy = ConflictResolution.useYaml;
        }
        else if (this.config.writeBackups) {
            npmlog_1.default.verbose("sync", "Attempting to read backups...");
            const jsonBackup = loadAndParse(this.backupPath(this.jsonName), JSON.parse, true) || this.jsonContents;
            const yamlBackup = loadAndParse(this.backupPath(this.yamlName), yaml_1.default.parse, true) || this.yamlContents;
            if (!deep_diff_1.diff(this.jsonContents, yamlBackup)) {
                npmlog_1.default.verbose("sync", "package.yaml has changed, applying to package.json");
                conflictStrategy = ConflictResolution.useYaml;
            }
            else if (!deep_diff_1.diff(this.yamlContents, jsonBackup)) {
                npmlog_1.default.verbose("sync", "package.json has changed, applying to package.yaml");
                conflictStrategy = ConflictResolution.useJson;
            }
            else if (!deep_diff_1.diff(jsonBackup, yamlBackup) && this.config.tryMerge) {
                npmlog_1.default.verbose("sync", "Both json and yaml have changed, attempting merge");
                const jsonDiff = deep_diff_1.diff(jsonBackup, this.jsonContents);
                const yamlDiff = deep_diff_1.diff(yamlBackup, this.yamlContents);
                const patchedJson = yamlDiff ? patchObject(JSON.parse(JSON.stringify(this.jsonContents)), yamlDiff) : this.jsonContents;
                const patchedYaml = jsonDiff ? patchObject(this.yamlContents, jsonDiff) : this.yamlContents;
                if (!deep_diff_1.diff(patchedJson, patchedYaml)) {
                    npmlog_1.default.verbose("sync", "Merge successful, continuing");
                    this.patchYaml(jsonDiff);
                    conflictStrategy = ConflictResolution.useYaml;
                }
                else {
                    npmlog_1.default.verbose("sync", "Merge unsuccessful, reverting to default resolution (%s)", conflictStrategy);
                }
            }
            else {
                npmlog_1.default.verbose("sync", "Backup(s) out of sync, reverting to default resolution (%s)", conflictStrategy);
            }
        }
        if (conflictStrategy == ConflictResolution.useLatest) {
            // We know that both yaml and json must exist, otherwise we wouldn't still be
            // set to useLatest
            npmlog_1.default.verbose("sync", "Checking timestamps...");
            const jsonTime = fs_1.default.statSync(this.jsonPath).mtimeMs / 1000.0;
            const yamlTime = fs_1.default.statSync(this.yamlPath).mtimeMs / 1000.0;
            if (Math.abs(yamlTime - jsonTime) <= this.config.timestampFuzz) {
                npmlog_1.default.verbose("sync", "Timestamp difference %ss <= fuzz factor %ss, reverting to ask", Math.abs(jsonTime - yamlTime), this.config.timestampFuzz);
                conflictStrategy = ConflictResolution.ask;
            }
            else if (yamlTime > jsonTime) {
                npmlog_1.default.verbose("sync", "%s %ss newer than package.json, overwriting", this.yamlName, yamlTime - jsonTime);
                conflictStrategy = ConflictResolution.useYaml;
            }
            else {
                npmlog_1.default.verbose("sync", "package.json %ss newer than %s, overwriting", jsonTime - yamlTime, this.yamlName);
                conflictStrategy = ConflictResolution.useJson;
            }
        }
        if (conflictStrategy == ConflictResolution.ask) {
            npmlog_1.default.verbose("sync", "Cannot sync, returning ask");
            return ConflictResolution.ask;
        }
        if (conflictStrategy == ConflictResolution.useJson) {
            npmlog_1.default.verbose("sync", "Patching %s with changes from package.json", this.yamlName);
            this.patchYaml(deep_diff_1.diff(this.yamlContents, this.jsonContents));
        }
        else if (conflictStrategy == ConflictResolution.useYaml) {
            npmlog_1.default.verbose("sync", "Patching package.json with changes from %s", this.yamlName);
            this.patchJson(deep_diff_1.diff(this.jsonContents, this.yamlContents));
        }
        this.writeBackups();
        return this.writePackageFiles();
    }
}
exports.Project = Project;
function patchObject(jsonContents, packageDiff) {
    for (let diffEntry of packageDiff) {
        deep_diff_1.applyChange(jsonContents, null, diffEntry);
    }
    return jsonContents;
}
function patchYamlDocument(yamlDoc, packageDiff) {
    for (const diffEntry of packageDiff) {
        const editPath = (diffEntry.path || []).concat(diffEntry.kind == 'A' ? diffEntry.index : []);
        const editItem = (diffEntry.kind == 'A') ? diffEntry.item : diffEntry;
        if (editItem.kind == 'E' || editItem.kind == 'N') {
            yamlDoc.setIn(editPath, typeof editItem.rhs == 'undefined' ? undefined : yaml_1.default.createNode(editItem.rhs));
        }
        else if (editItem.kind == 'D') {
            yamlDoc.deleteIn(editPath);
        }
    }
    return yamlDoc;
}
class PackageYamlCmd extends npm_autoloader_1.NPMExtensionCommand {
    constructor() {
        super(...arguments);
        this.usage = "npm package-yaml use-yaml\n"
            + "npm package-yaml use-json";
    }
    execute(args) {
        npmlog_1.default.verbose("PackageYamlCommand", "called with args: %j", args);
        const project = new Project(this.npm.config.localPrefix);
        if (args[0] && args[0].startsWith('use-')) {
            project.config.updateAndLock({ conflicts: args[0] });
        }
        const syncResult = project.sync();
        if (syncResult === 'ask') {
            console.error("Could not sync package.yaml and package.json. Try executing one of:\n"
                + "  npm package-yaml use-yaml\n"
                + "  npm package-yaml use-json");
        }
    }
}
function syncPackageYaml(projectDir) {
    npmlog_1.default.verbose("syncPackageYaml", "loading, projectDir: %s", projectDir);
    try {
        const syncResult = new Project(projectDir).sync();
        if (syncResult !== true) {
            return false; // let the caller tell the client what to do
        }
        process.on('exit', function () {
            new Project(projectDir).sync(ConflictResolution.useJson);
        });
        return true;
    }
    catch (e) {
        npmlog_1.default.error("syncPackageYaml", "Unexpected error: %s", e);
        return false;
    }
}
function _npm_autoload(npm, command) {
    npmlog_1.default.verbose("_npm_autoloader", "called via npm-autoloader");
    npm.commands['package-yaml'] = new PackageYamlCmd(npm);
    if (command == "package-yaml") {
        npmlog_1.default.verbose("_npm_autoloader", "not automatically syncing because of package-yaml command");
        return;
    }
    if (!syncPackageYaml(npm.config.localPrefix)) {
        console.error("Could not sync package.yaml and package.json, aborting. Try executing one of:\n"
            + "  npm package-yaml use-yaml\n"
            + "  npm package-yaml use-json\n"
            + "and then try this command again.");
        npm_autoloader_1.npmExit(1);
    }
}
exports._npm_autoload = _npm_autoload;
if (npm_autoloader_1.calledFromNPM(module)) {
    npmlog_1.default.verbose("(main)", "called via onload-script");
    const npm = npm_autoloader_1.getNPM(module);
    if (!syncPackageYaml(npm.config.localPrefix)) {
        let cmdline = "[args...]";
        if (process.argv.slice(2).every(arg => /^[a-zA-Z0-9_.,\/-]+$/.test(arg))) {
            cmdline = process.argv.slice(2).join(" ");
        }
        console.error("Could not sync package.yaml and package.json. Try executing one of:\n"
            + `  PACKAGE_YAML_FORCE=yaml npm ${cmdline}\n`
            + `  PACKAGE_YAML_FORCE=json npm ${cmdline}\n`
            + "and then try this command again.");
        npm_autoloader_1.npmExit(1);
    }
}
else if (!module.parent) {
    npmlog_1.default.verbose("(main)", "called directly from command line");
    const dir = pkg_dir_1.default.sync();
    if (dir) {
        syncPackageYaml(dir);
    }
    else {
        npmlog_1.default.verbose("(main)", "Cannot find project dir, aborting");
    }
}
else {
    npmlog_1.default.verbose("(main)", "not main module");
}
