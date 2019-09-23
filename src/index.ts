#!/usr/bin/env node

import * as yaml from 'yaml';
import * as fs from 'fs';
import * as path from 'path';
import { diff, Diff } from 'deep-diff';

if (!process.env.DEBUG_PACKAGE_YAML) {
  console.debug = () => {};
}

function yamlToJsonSync(jsonFilePath: string, jsonData: object | null,
                        yamlData: object, yamlBackup: object | null): boolean {
  console.debug("yamlToJsonSync with: ",{jsonFilePath,jsonData,yamlData,yamlBackup});
  if (!diff(jsonData, yamlData)) {
    console.debug("package.yaml in sync with package.json, not writing");
    return true;
  } else if (jsonData && diff(jsonData, yamlBackup)) {
    // ensure json matches either active or backup yaml file
    if (diff(jsonData, yamlData) && diff(jsonData, yamlBackup)) {
      // json does NOT match
      console.error("package.json out of sync with package.yaml, delete one and try again");
      return false;
    }
  }
  const jsonFileData = JSON.stringify(yamlData, null, 4);
  console.debug("yaml and JSON in sync, writing package.json");
  fs.writeFileSync(jsonFilePath, jsonFileData);
  return true;
}

declare interface YamlDocument extends yaml.ast.Document {
  getIn(path: string[], keepScalar?: boolean): yaml.ast.AstNode | null;
}

declare interface YamlCollection extends yaml.ast.Node {
  get(key:string|number, keepScalar?: boolean): yaml.ast.AstNode | null;
  set(key:string|number, value:any): void;
  delete(key:string|number): void;
}

function patchYaml(yamlDoc: YamlDocument, packageDiff: Diff<any,any>[]):YamlDocument {
  for (let diffEntry of packageDiff) {
    if (diffEntry.kind == 'E' && !diffEntry.path) {
      yamlDoc.contents = yaml.createNode(diffEntry.rhs) as yaml.ast.MapNode;
      continue;
    }
    const entryPath: string[] = diffEntry.path || [];
    const leadingPath = entryPath.slice(0, (diffEntry.kind == 'A' ? undefined : -1));
    const astNode:YamlCollection | null = yamlDoc.getIn(leadingPath) as unknown as YamlCollection;
    if (!astNode) {
      console.warn("Could not get path for entry: ",diffEntry);
      continue;
    }
    const lastPath = (diffEntry.kind == 'A') ? diffEntry.index : entryPath[entryPath.length - 1];
    const editItem = (diffEntry.kind == 'A') ? diffEntry.item : diffEntry;
    if (editItem.kind == 'E' || editItem.kind == 'N') {
      astNode.set(lastPath, yaml.createNode(editItem.rhs));
    } else if (editItem.kind == 'D') {
      astNode.delete(lastPath);
    }
  }
  return yamlDoc;
}

function writeYaml(yamlFilePath: string, yamlDoc: yaml.ast.Document):void {
  fs.writeFileSync(yamlFilePath, yamlDoc.toString())
}


function getJson(jsonFilePath: string): object | null {
  try {
    const jsonFileData = fs.readFileSync(jsonFilePath, "utf8");
    return JSON.parse(jsonFileData);
  } catch {
    return null;
  }
}

function getYaml(yamlFilePath:string): yaml.ast.Document | null {
  try {
    const yamlFileData = fs.readFileSync(yamlFilePath, "utf8");
    return yaml.parseDocument(yamlFileData);
  } catch {
    return null;
  }
}


function syncPackageYaml(): void {
  const projectDir = process.cwd();
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJsonExists = fs.existsSync(packageJsonPath);
  //const jsonBackupPath = path.join(projectDir, ".package.json~");
  //const jsonBackupExists = fs.existsSync(jsonBackupPath);
  const ymlFilePath = path.join(projectDir, "package.yml");
  const yamlFilePath = path.join(projectDir, "package.yaml");
  const yamlBackupPath = path.join(projectDir, ".package.yaml~")
  const ymlFileExists = fs.existsSync(ymlFilePath);
  const yamlFileExists = fs.existsSync(yamlFilePath);
  const yamlBackupExists = fs.existsSync(yamlBackupPath);
  const packageYamlPath = ymlFileExists ? ymlFilePath : yamlFilePath;
  const packageYamlExists = ymlFileExists || yamlFileExists;
  
  const oldPackageJson = packageJsonExists ? getJson(packageJsonPath) : null;
  //const oldJsonBackup = jsonBackupExists ? getJson(jsonBackupPath): null;
  const oldPackageYaml = packageYamlExists ? getYaml(packageYamlPath): null;
  const oldYamlBackup = yamlBackupExists ? getYaml(yamlBackupPath): null;
  
  const yamlInSync = oldPackageYaml
      ? yamlToJsonSync(packageJsonPath, oldPackageJson,
                       oldPackageYaml&&oldPackageYaml.toJSON(), oldYamlBackup&&oldYamlBackup.toJSON())
      : true;
  
  const initPackageJson:object = (oldPackageYaml && yamlInSync)
      ? oldPackageYaml.toJSON()
      : oldPackageJson;

  if (yamlInSync) {
    console.debug("package in sync, registering exit");
    process.on('exit', function() {
      const newPackageJson = getJson(packageJsonPath);
      if (newPackageJson) {
        const yamlDoc = oldPackageYaml || new yaml.Document();
        const packageDiff = diff(oldPackageYaml ? initPackageJson : null, newPackageJson);
        if (packageDiff) {
          patchYaml(yamlDoc as YamlDocument, packageDiff);
          writeYaml(packageYamlPath, yamlDoc);
          writeYaml(yamlBackupPath, yamlDoc);
        }
      }
    });
  }
}

export function _npm_autoload() {
  console.debug("called via npm-autoloader");
  syncPackageYaml();
}

if (!module.parent || module.parent.id.endsWith('/npm.js')) {
  console.debug("called directly via onload-script or from command line");
  syncPackageYaml();
} else {
  console.debug("not main module");
}
