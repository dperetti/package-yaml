#!/usr/bin/env node

/// <reference path="../types/yaml.d.ts" />

import yaml from 'yaml';
import fs from 'fs';
import path from 'path';
import { diff, Diff, applyChange } from 'deep-diff';
import log from 'npmlog';
import 'reflect-metadata';
import osenv from 'osenv';
import { calledFromNPM, getNPM, NPMExtensionCommand, npmExit } from 'npm-autoloader';
import pkgDir from 'pkg-dir';

log.heading = 'package-yaml';
if (!!process.env.DEBUG_PACKAGE_YAML) {
    log.level = 'verbose';
}

type Constructor<T> =
    T extends (undefined|null) ? never :
    T extends string ? StringConstructor :
    T extends number ? NumberConstructor :
    T extends boolean ? BooleanConstructor :
    T extends Function ? FunctionConstructor :
    T extends symbol ? SymbolConstructor :
    T extends bigint ? BigIntConstructor :
    new(...args:any[]) => T;
type Instance<T> = 
    T extends SymbolConstructor ? Symbol :
    T extends BigIntConstructor ? BigInt :
    T extends new(...args:any)=>any ? InstanceType<T> :
    never;

type PickTypedPropNames<T, U> = NonNullable<{[k in keyof T]: T[k] extends U ? k : never}[keyof T]>;
type PickTypedProps<T, U> = Pick<T, PickTypedPropNames<T, U>>;
type SimplePropNames<T> = PickTypedPropNames<T, string|boolean|number>;
type SimpleProps<T> = PickTypedProps<T, string|boolean|number>;

const propertyClassesKey = Symbol("propertyClasses");

function property(target: object, propertyKey: string) {
    const propClasses: {[p:string]:Constructor<any>} = Reflect.getOwnMetadata(propertyClassesKey, target.constructor) || {};
    const propClass:Constructor<any> = Reflect.getMetadata('design:type', target, propertyKey);
    propClasses[propertyKey] = propClass;
    Reflect.defineMetadata(propertyClassesKey, propClasses, target.constructor);
}

function getPropClasses<T extends object>(target:Constructor<T> | T): {[k in keyof T]: Constructor<T[k]>} {
    const classTarget:Constructor<T> = typeof target === "object" ? target.constructor as Constructor<T> : target
    const classProperties = Reflect.getOwnMetadata(propertyClassesKey, classTarget) || {};
    return classProperties;
}

function getProps<T extends object, P extends keyof T>(target:Constructor<T> | T): P[] {
    return Object.keys(getPropClasses(target)) as P[];
}

function getPropClass<T extends object, P extends keyof T>(target:Constructor<T> | T, prop:P): Constructor<T[P]> {
    return getPropClasses(target)[prop];
}

function isPropClass<T extends object, U extends Constructor<any>>(target: Constructor<T>, prop: keyof T, cls: U): prop is PickTypedPropNames<T, Instance<U>> {
    const propClass:Constructor<any> = getPropClass(target, prop);
    return (propClass === cls);
}

enum ConflictResolution {
    ask = "ask",
    useJson = "use-json",
    useYaml = "use-yaml",
    useLatest = "use-latest",
};

type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
}
class Config  {
    @property readonly debug: boolean = false;
    @property readonly writeBackups: boolean = true;
    @property readonly backupPath: string = ".%s~"; // %s - basename; %S - full path with % interpolations
    @property readonly timestampFuzz: number = 5;
    @property readonly conflicts: ConflictResolution = ConflictResolution.ask;
    @property readonly tryMerge: boolean = true; // Only functions when backups are being written

    @property readonly defaultExtension: "yaml" | "yml" = "yaml";

    _lockedProps: {-readonly [k in keyof Config]?: boolean} = {};

    constructor(loadConfigFiles:boolean = true) {
        if (!!process.env.DEBUG_PACKAGE_YAML) {
            this.updateAndLock({debug:true})
        }
        if (process.env.PACKAGE_YAML_FORCE) {
            const confl = `use-${process.env.PACKAGE_YAML_FORCE}`;
            if (Config.isValid("conflicts",confl)) {
                this.updateAndLock({conflicts: confl});
            }
        }
        if (loadConfigFiles) {
            this.loadSystemConfig();
        }
    }

    loadSystemConfig():void {
        for (let globalPath of ['/etc','/usr/local/etc']) {
            // FIXME: this won't work on Windows
            this.loadConfigFile(path.join(globalPath, "package-yaml.json"));
            this.loadConfigFile(path.join(globalPath, "package-yaml.yaml"));
        }
        const home = osenv.home();
        this.loadConfigFile(path.join(home, ".package-yaml.json"));
        this.loadConfigFile(path.join(home, ".package-yaml.yaml"));
}

    static isValid<P extends keyof Config>(prop:P, value:any): value is Config[P] {
        log.verbose("Config.isValid","checking %s: %s", prop, value);
        if (prop === "conflicts") {
            log.verbose("Config.isValid","ovcfr: %o; includes: %s",Object.values(ConflictResolution),Object.values(ConflictResolution).includes(value as ConflictResolution));
            return typeof value === 'string' && (Object.values(ConflictResolution).includes(value as ConflictResolution));
        } else if (prop === "defaultExtension") {
            return value === 'yaml' || value === 'yml';
        } else if (isPropClass(Config, prop, String)) {
            return typeof value === 'string';
        } else if (isPropClass(Config, prop, Boolean)) {
            return true; // anything can be a Boolean if you just believe
        } else if (isPropClass(Config, prop, Number)) {
            return !isNaN(Number(value));
        }
        return false;
    }

    validate(values: any): Partial<SimpleProps<Config>> {
        const valid:Mutable<Partial<SimpleProps<Config>>> = {};
        const propNames = getProps(Config);

        for (const prop of propNames) {
            const val:any = values[prop];
            if (this._lockedProps[prop] || !(prop in values) || !Config.isValid(prop, val)) {
                continue;
            }
            if (isPropClass(Config, prop, String)) {
                valid[prop] = String(values[prop]) as any; // We've already validated these
            } else if (isPropClass(Config, prop, Boolean)) {
                valid[prop] = !!values[prop];
            } else if (isPropClass(Config, prop, Number)) {
                valid[prop] = Number(values[prop]);
            }
        }
        return valid;
    }
    update(values: Partial<SimpleProps<Config>>):Partial<SimpleProps<Config>> {
        const valid = this.validate(values);
        Object.assign(this, valid);
        if ('debug' in valid) {
            log.level = valid.debug ? 'verbose' : 'info';
        }
        return valid;
    }

    lock(props: SimplePropNames<Config>[]):void {
        for (let prop of props) {
            if (prop in this) {
                this._lockedProps[prop as SimplePropNames<Config>] = true;
            }
        }
    }

    updateAndLock(values: Partial<SimpleProps<Config>>):Partial<SimpleProps<Config>> {
        const updated = this.update(values);
        this.lock(Object.keys(updated) as SimplePropNames<Config>[]);
        return updated;
    }

    loadConfigFile(path:string, rootElement?:string):Partial<SimpleProps<Config>>|null {
        let configData:string;
        let configParsed;
        try {
            if (!fs.existsSync(path)) {
                return null;
            }
            configData = fs.readFileSync(path, {encoding: "utf8"});
        } catch (e) {
            log.error("loadConfig", "Error loading config file %s: %s", path, e);
            return null;
        }
        try {
            // YAML parsing *should* work for JSON files without issue
            configParsed = yaml.parse(configData);
        } catch (yamlError) {
            // try using JSON as a backup
            try {
                configParsed = JSON.parse(configData)
            } catch (jsonError) {
                const error = path.endsWith(".json") ? jsonError : yamlError;
                log.error("loadConfig", "Error parsing YAML/JSON config file %s: %s", path, error);
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
                log.error("loadConfig", "Invalid configuration stanza %s in %s (should be an object)", rootElement, path);
            } else {
                log.error("loadConfig", "Invalid configuration file %s (should be a JSON/YAML object)", path);
            }
            return null;
        }
        return this.update(configParsed);
    }
};

function loadAndParse<T>(path:string, parser:(data:string)=>T, inhibitErrors?:false): T;
function loadAndParse<T>(path:string, parser:(data:string)=>T, inhibitErrors?:true): T | null;
function loadAndParse<T>(path:string, parser:(data:string)=>T, inhibitErrors=false): T | null {
    try {
        const data = fs.readFileSync(path, {encoding:"utf8"});
        return parser(data);
    } catch (e) {
        if (inhibitErrors) {
            return null;
        }
        throw e;
    }
}

export class Project {
    readonly projectDir: string;
    yamlExtension: string | null;

    readonly config = new Config();

    get jsonName() {
        return "package.json";
    }

    get yamlName() {
        return `package.${this.yamlExtension || this.config.defaultExtension}`;
    }

    projectPath(localPath: string): string {
        return path.join(this.projectDir, localPath);
    }
    get jsonPath() {
        return this.projectPath(this.jsonName);
    }

    get yamlPath() {
        return this.projectPath(this.yamlName);
    }

    readonly jsonExists:boolean;
    readonly yamlExists:boolean;

    yamlModified:boolean = false;
    jsonModified:boolean = false;

    private _jsonContents?:object;
    private _yamlDocument?:yaml.ast.Document;

    get jsonContents():object {
        if (this._jsonContents) return this._jsonContents;
        if (this.jsonExists) {
            try {
                return this._jsonContents = loadAndParse(this.jsonPath, JSON.parse);
            } catch (e) {
                log.error("loadJson", "Cannot load or parse %s: %s", this.jsonPath, e);
                throw e;
            }
        } else {
            return this._jsonContents = {};
        }
    }
    set jsonContents(value:object) {
        if (diff(this._jsonContents, value)) {
            this.jsonModified = true;
        }
        this._jsonContents = value;
    }

    get yamlDocument():yaml.ast.Document {
        if (this._yamlDocument) return this._yamlDocument;
        if (this.yamlExists) {
            try {
                return this._yamlDocument = loadAndParse(this.yamlPath, yaml.parseDocument);
            } catch (e) {
                log.error("loadYaml", "Cannot load or parse %s: %s", this.yamlPath, e);
                throw e;
            }
        } else {
            return this._yamlDocument = new yaml.Document();
        }
    }
    set yamlDocument(value:yaml.ast.Document) {
        if (this._yamlDocument !== value) {
            this.yamlModified = true;
        }
        this._yamlDocument = value;
    }

    get yamlContents():object {
        return this.yamlDocument.toJSON();
    }

    backupPath(filename:string): string {
        const fullPath = this.projectPath(filename).replace(/\//g, '%');
        const backupPath = this.config.backupPath
            .replace("%s", filename)
            .replace("%S", fullPath);
        return path.resolve(this.projectDir, backupPath);
    }

    constructor(projectDir: string) {
        this.projectDir = projectDir;
        this.yamlExtension =
            fs.existsSync(this.projectPath('package.yaml')) ? 'yaml' :
            fs.existsSync(this.projectPath('package.yml')) ? 'yml' :
            null;
        this.config.loadConfigFile(this.projectPath("package-yaml.json"));
        this.config.loadConfigFile(this.projectPath("package-yaml.yaml"));
        this.config.loadConfigFile(this.jsonPath, "package-yaml");
        this.config.loadConfigFile(this.yamlPath, "package-yaml");
        this.jsonExists = fs.existsSync(this.jsonPath);
        this.yamlExists = fs.existsSync(this.yamlPath);
    }

    writeBackups():boolean {
        let success = true;
        if (!this.config.writeBackups) return success;
        try {
            fs.writeFileSync(this.backupPath(this.jsonName),JSON.stringify(this.jsonContents, null, 4));
        } catch (e) {
            success = false;
            log.warn("writeBackups", "Error writing backup package.json file at %s: %s", this.backupPath(this.jsonName), e);
        }
        try {
            fs.writeFileSync(this.backupPath(this.yamlName),this.yamlDocument.toString());
        } catch (e) {
            success = false;
            log.warn("writeBackups", "Error writing backup %s file at %s: %s", this.yamlName, this.backupPath(this.yamlName), e);
        }
        return success;
    }

    writePackageFiles():boolean {
        let success = true;
        if (this.yamlModified) {
            try {
                fs.writeFileSync(this.yamlPath, this.yamlDocument.toString());
                this.yamlModified = false;
            } catch (e) {
                success = false;
                log.error("writePackageFiles", "Error writing %s: %s", this.yamlPath, e);
            }
        }
        if (this.jsonModified) {
            try {
                fs.writeFileSync(this.jsonPath, JSON.stringify(this.jsonContents, null, 4));
                this.jsonModified = false;
            } catch (e) {
                success = false;
                log.error("writePackageFiles", "Error writing %s: %s", this.jsonPath, e);
            }
        }
        return success;
    }

    patchYaml(diff: Diff<any,any>[] | null | undefined): yaml.ast.Document {
        if (diff) {
            this.yamlDocument = patchYamlDocument(this.yamlDocument, diff);
            this.yamlModified = true;
        }
        return this.yamlDocument;
    }

    patchJson(diff: Diff<any,any>[] | null | undefined): any {
        if (diff) {
            this.jsonContents = patchObject(this.jsonContents, diff);
            this.jsonModified = true;
        }
        return this.jsonContents;
    }

    sync(conflictStrategy?:ConflictResolution):boolean | ConflictResolution.ask {
        conflictStrategy = conflictStrategy || this.config.conflicts;
        if (!diff(this.jsonContents, this.yamlContents)) {
            log.verbose("sync", "Package files already in sync, writing backups");
            this.writeBackups();
            return true;
        }
        log.verbose("sync", "Package files out of sync. Trying to resolve...");
        if (!this.yamlExists) {
            log.verbose("sync", `${this.yamlName} does not exist, creating from package.json`);
            conflictStrategy = ConflictResolution.useJson;
        } else if (!this.jsonExists) {
            log.verbose("sync", `package.json does not exist, using ${this.yamlName}`);
            conflictStrategy = ConflictResolution.useYaml;
        } else if (this.config.writeBackups) {
            log.verbose("sync", "Attempting to read backups...");
            const jsonBackup = loadAndParse(this.backupPath(this.jsonName), JSON.parse, true) || this.jsonContents;
            const yamlBackup = loadAndParse(this.backupPath(this.yamlName), yaml.parse, true) || this.yamlContents;
            if (!diff(this.jsonContents, yamlBackup)) {
                log.verbose("sync", "package.yaml has changed, applying to package.json");
                conflictStrategy = ConflictResolution.useYaml;
            } else if (!diff(this.yamlContents, jsonBackup)) {
                log.verbose("sync", "package.json has changed, applying to package.yaml");
                conflictStrategy = ConflictResolution.useJson;
            } else if (!diff(jsonBackup, yamlBackup) && this.config.tryMerge) {
                log.verbose("sync", "Both json and yaml have changed, attempting merge");
                const jsonDiff = diff(jsonBackup, this.jsonContents);
                const yamlDiff = diff(yamlBackup, this.yamlContents);
                const patchedJson = yamlDiff ? patchObject(JSON.parse(JSON.stringify(this.jsonContents)), yamlDiff) : this.jsonContents;
                const patchedYaml = jsonDiff ? patchObject(this.yamlContents, jsonDiff) : this.yamlContents;
                if (!diff(patchedJson, patchedYaml)) {
                    log.verbose("sync", "Merge successful, continuing")
                    this.patchYaml(jsonDiff);
                    conflictStrategy = ConflictResolution.useYaml;
                } else {
                    log.verbose("sync", "Merge unsuccessful, reverting to default resolution (%s)", conflictStrategy);
                }
            } else {
                log.verbose("sync", "Backup(s) out of sync, reverting to default resolution (%s)", conflictStrategy);
            }
        }

        if (conflictStrategy == ConflictResolution.useLatest) {
            // We know that both yaml and json must exist, otherwise we wouldn't still be
            // set to useLatest
            log.verbose("sync", "Checking timestamps...");
            const jsonTime = fs.statSync(this.jsonPath).mtimeMs / 1000.0;
            const yamlTime = fs.statSync(this.yamlPath).mtimeMs / 1000.0;
            if (Math.abs(yamlTime - jsonTime) <= this.config.timestampFuzz) {
                log.verbose("sync", "Timestamp difference %ss <= fuzz factor %ss, reverting to ask", Math.abs(jsonTime - yamlTime), this.config.timestampFuzz);
                conflictStrategy = ConflictResolution.ask;
            } else if (yamlTime > jsonTime) {
                log.verbose("sync", "%s %ss newer than package.json, overwriting", this.yamlName, yamlTime - jsonTime);
                conflictStrategy = ConflictResolution.useYaml;
            } else {
                log.verbose("sync", "package.json %ss newer than %s, overwriting", jsonTime - yamlTime, this.yamlName);
                conflictStrategy = ConflictResolution.useJson;
            }
        }

        if (conflictStrategy == ConflictResolution.ask) {
            log.verbose("sync", "Cannot sync, returning ask")
            return ConflictResolution.ask;
        }

        if (conflictStrategy == ConflictResolution.useJson) {
            log.verbose("sync", "Patching %s with changes from package.json", this.yamlName);
            this.patchYaml(diff(this.yamlContents, this.jsonContents));
        } else if (conflictStrategy == ConflictResolution.useYaml) {
            log.verbose("sync", "Patching package.json with changes from %s", this.yamlName);
            this.patchJson(diff(this.jsonContents, this.yamlContents));
        }

        this.writeBackups();
        return this.writePackageFiles();
    }
}

function patchObject(jsonContents: any, packageDiff: Diff<any,any>[]): any {
    for (let diffEntry of packageDiff) {
        applyChange(jsonContents,null,diffEntry);
    }
    return jsonContents;
}

function patchYamlDocument(yamlDoc: yaml.ast.Document, packageDiff: Diff<any,any>[]):yaml.ast.Document {
    for (const diffEntry of packageDiff) {
        const editPath = (diffEntry.path||[]).concat(diffEntry.kind == 'A' ? diffEntry.index: []);
        const editItem = (diffEntry.kind == 'A') ? diffEntry.item : diffEntry;
        if (editItem.kind == 'E' || editItem.kind == 'N') {
            yamlDoc.setIn(editPath, typeof editItem.rhs == 'undefined' ? undefined : yaml.createNode(editItem.rhs));
        } else if (editItem.kind == 'D') {
            yamlDoc.deleteIn(editPath);
        }
    }
    return yamlDoc;
}



class PackageYamlCmd extends NPMExtensionCommand {
    execute(args:string[]):any {
        log.verbose("PackageYamlCommand", "called with args: %j", args);
        const project = new Project(this.npm.config.localPrefix);
        if (args[0] && args[0].startsWith('use-')) {
            project.config.updateAndLock({conflicts:args[0] as ConflictResolution});
        }
        const syncResult = project.sync();
        if (syncResult === 'ask') {
            console.error("Could not sync package.yaml and package.json. Try executing one of:\n"
            +"  npm package-yaml use-yaml\n"
            +"  npm package-yaml use-json");
        }
    }

    usage = "npm package-yaml use-yaml\n"
          + "npm package-yaml use-json";
}

function syncPackageYaml(projectDir: string):boolean {
    log.verbose("syncPackageYaml", "loading, projectDir: %s", projectDir);
    try {
        const syncResult = new Project(projectDir).sync();
        if (syncResult !== true) {
            return false; // let the caller tell the client what to do
        }
        process.on('exit', function() {
            new Project(projectDir).sync(ConflictResolution.useJson);
        });
        return true;
    } catch (e) {
        log.error("syncPackageYaml", "Unexpected error: %s", e);
        return false;
    }
}

export function _npm_autoload(npm: NPM.Static, command:string) {
    log.verbose("_npm_autoloader","called via npm-autoloader");
    npm.commands['package-yaml'] = new PackageYamlCmd(npm);

    if (command == "package-yaml") {
        log.verbose("_npm_autoloader","not automatically syncing because of package-yaml command");
        return;
    }
    if (!syncPackageYaml(npm.config.localPrefix)) {
        console.error("Could not sync package.yaml and package.json, aborting. Try executing one of:\n"
                        +"  npm package-yaml use-yaml\n"
                        +"  npm package-yaml use-json\n"
                        +"and then try this command again.");
        npmExit(1);
    }
}

if (calledFromNPM(module)) {
    log.verbose("(main)", "called via onload-script");
    const npm = getNPM(module);
    if (!syncPackageYaml(npm.config.localPrefix)) {
        let cmdline = "[args...]";
        if (process.argv.slice(2).every(arg=>/^[a-zA-Z0-9_.,\/-]+$/.test(arg))) {
            cmdline = process.argv.slice(2).join(" ");
        }
        console.error("Could not sync package.yaml and package.json. Try executing one of:\n"
        +`  PACKAGE_YAML_FORCE=yaml npm ${cmdline}\n`
        +`  PACKAGE_YAML_FORCE=json npm ${cmdline}\n`
        +"and then try this command again.");
        npmExit(1);
    }
} else if (!module.parent) {
    log.verbose("(main)","called directly from command line");
    const dir = pkgDir.sync();
    if (dir) {
        syncPackageYaml(dir);
    } else {
        log.verbose("(main)","Cannot find project dir, aborting");
    }
} else {
    log.verbose("(main)","not main module");
}
