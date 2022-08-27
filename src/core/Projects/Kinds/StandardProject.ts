import * as path from "@extensions/path";
import * as fs from "@extensions/fs";
import * as xml from "@extensions/xml";
import * as SolutionExplorerConfiguration from "@extensions/config";
import { ProjectInSolution } from "../../Solutions";
import { ProjectFile } from "../ProjectFile";
import { ProjectFolder } from "../ProjectFolder";
import { PackageReference } from "../PackageReference";
import { ProjectReference } from "../ProjectReference";
import { FileSystemBasedProject } from "./FileSystemBasedProject";

function commonPrefix(x: string, y: string): string {
    if (x > y) {
        [x, y] = [y, x];
    }

    let i = 0;
    for (; i < x.length; i++) {
        if (x[i] !== y[i]) {
            break;
        }
    }
    return x.substr(0, i);
}

export type TreePart = { name: string, virtualpath: string, fullpath: string, children: TreePart[] };

export class StandardProject extends FileSystemBasedProject {
    private loaded: boolean = false;
    private loadedPackages: boolean = false;
    private references: ProjectReference[] = [];
    private packages: PackageReference[] = [];
    private document: xml.XmlElement | undefined = undefined;
    private folders: string[] = [];
    private filesTree: TreePart[] | undefined = undefined;
    private currentItemGroup: xml.XmlElement | undefined = undefined;
    private shouldReload: boolean = true;
    protected dependents: { [id: string]: string[] } = {};
    protected includePrefix: string | undefined = undefined;

    constructor(projectInSolution: ProjectInSolution, document?: xml.XmlElement, type?: string) {
        super(projectInSolution, type ? type : 'standard');

        if (document) {
            this.parseDocument(document);
            this.loaded = true;
        }
    }

    public async getProjectReferences(): Promise<ProjectReference[]> {
        await this.checkProjectLoaded();
        return this.references;
    }

    public async getPackageReferences(): Promise<PackageReference[]> {
        await this.checkProjectLoaded();
        return this.packages;
    }

    public async getProjectFilesAndFolders(virtualPath?: string): Promise<{ files: ProjectFile[]; folders: ProjectFolder[]; }> {
        await this.checkProjectLoaded();

        let currentLevel = this.filesTree || [];
        if (virtualPath) {
            let pathParts = virtualPath.split(path.sep);
            pathParts.forEach(part => {
                let existingPathIndex = currentLevel.findIndex((i: TreePart) => i.name === part);
                if (existingPathIndex >= 0) {
                    currentLevel = currentLevel[existingPathIndex].children;
                }
            });
        }

        let folders: ProjectFolder[] = [];
        let files: ProjectFile[] = [];
        for(let i = 0; i < currentLevel.length; i++) {
            let item = currentLevel[i];
            try {
                let isDirectory = await fs.isDirectory(item.fullpath);
                if (isDirectory) {
                    folders.push(new ProjectFolder(item.fullpath));
                } else {
                    let projectFile = new ProjectFile(item.fullpath);
                    this.addFileDependents(item, projectFile);
                    files.push(projectFile);
                }
            }
            catch(err: any) {
                console.info("Error: " + item.fullpath + " - " + err.message);
            }
        }

        folders.sort((a, b) => {
            let x = a.name.toLowerCase();
            let y = b.name.toLowerCase();
            return x < y ? -1 : x > y ? 1 : 0;
        });

        files.sort((a, b) => {
            let x = a.name.toLowerCase();
            let y = b.name.toLowerCase();
            return x < y ? -1 : x > y ? 1 : 0;
        });

        return { files, folders };
    }

    public async renameFile(filepath: string, name: string): Promise<string> {
        await this.checkProjectLoaded();
        let relativePath = this.getRelativePath(filepath);
        let newRelativePath = path.join(path.dirname(relativePath), name);
        this.renameInNodes(relativePath, newRelativePath);
        let newFilepath = await super.renameFile(filepath, name);
        await this.saveProject();
        return newFilepath;
    }

    public async deleteFile(filepath: string): Promise<void> {
        await this.checkProjectLoaded();
        let relativePath = this.getRelativePath(filepath);
        let folderRelativePath = path.dirname(relativePath);
        this.removeInNodes(relativePath);
        if (folderRelativePath !== '.' && this.countInNodes(folderRelativePath, true) === 0) {
            this.currentItemGroupAdd('Folder', folderRelativePath, true);
        }
        await super.deleteFile(filepath);
        await this.saveProject();
    }

    public async createFile(folderpath: string, filename: string, content?: string): Promise<string> {
        await this.checkProjectLoaded();

        let folderRelativePath = this.getRelativePath(folderpath);
        let relativePath = path.join(folderRelativePath, filename);
        let extension = (relativePath.split('.').pop() || "").toLocaleLowerCase();

        let type = 'None';
        let itemTypes = SolutionExplorerConfiguration.getItemTypes();
        if (itemTypes[extension]) {
            type = itemTypes[extension];
        } else {
            type = itemTypes['*'];
        }

        if (!type)  {
            type = 'None';
        }

        if (folderRelativePath) {
            // maybe the folder was empty
            this.removeInNodes(folderRelativePath, true, ['Folder']);
        }

        this.currentItemGroupAdd(type, relativePath);
        await this.saveProject();
        return await super.createFile(folderpath, filename, content);
    }

    public async renameFolder(folderpath: string, name: string): Promise<string> {
        await this.checkProjectLoaded();
        let relativePath = this.getRelativePath(folderpath);
        let newRelativePath = path.join(path.dirname(relativePath), name);
        this.renameInNodes(relativePath, newRelativePath, true);
        let newFolderpath = await super.renameFolder(folderpath, name);
        await this.saveProject();
        return newFolderpath;
    }

    public async deleteFolder(folderpath: string): Promise<void> {
        await this.checkProjectLoaded();
        let folderRelativePath = this.getRelativePath(folderpath);
        this.removeInNodes(folderRelativePath, true);
        await super.deleteFolder(folderpath);
        await this.saveProject();
    }

    public async createFolder(folderpath: string): Promise<string> {
        await this.checkProjectLoaded();
        let folderRelativePath = this.getRelativePath(folderpath);
        let parentRelativePath = path.dirname(folderRelativePath);
        if (parentRelativePath) {
            // maybe the container folder was empty
            this.removeInNodes(parentRelativePath, true, ['Folder']);
        }
        this.currentItemGroupAdd('Folder', folderRelativePath, true);
        let newFolderpath = await super.createFolder(folderpath);
        await this.saveProject();
        return newFolderpath;
    }

    public async getFolderList(): Promise<string[]> {
        let directories = await this.getFoldersFromTree(this.filesTree || []);

        directories.sort((a, b) => {
            let x = a.toLowerCase();
            let y = b.toLowerCase();
            return x < y ? -1 : x > y ? 1 : 0;
        });

        let result: string[] = [ '.' + path.sep ];
        directories.forEach(dirPath => result.push(this.getRelativePath(dirPath)));
        return result;
    }

    public async moveFile(filepath: string, newfolderPath: string): Promise<string> {
        await this.checkProjectLoaded();

        let newFilepath = await super.moveFile(filepath, newfolderPath);
        let relativePath = this.getRelativePath(filepath);
        let newRelativePath = this.getRelativePath(newFilepath);
        this.renameInNodes(relativePath, newRelativePath);
        await this.saveProject();
        return newFilepath;
    }

    public async moveFolder(folderpath: string, newfolderPath: string): Promise<string> {
        await this.checkProjectLoaded();

        let newFolderPath = await super.moveFile(folderpath, newfolderPath);
        let relativePath = this.getRelativePath(folderpath);
        let newRelativePath = this.getRelativePath(newFolderPath);
        this.renameInNodes(relativePath, newRelativePath, true);
        await this.saveProject();
        return newFolderPath;
    }

    public async refresh(): Promise<void> {
        if (!this.shouldReload) {
            this.shouldReload = true;
            return;
        }

        this.loaded = false;
        this.loadedPackages = false;
        this.references = [];
        await this.checkProjectLoaded();
    }

    protected addFileDependents(item: TreePart, projectFile: ProjectFile) {
        if (this.dependents[item.virtualpath]) {
            projectFile.hasDependents = true;
            this.dependents[item.virtualpath].forEach(d => {
                let dependentFullPath = path.join(path.dirname(this.fullPath), d);
                projectFile.dependents.push(new ProjectFile(dependentFullPath));
            });
        }
    }

    private async checkProjectLoaded(): Promise<void> {
        if (!this.loaded) {
            let content = await fs.readFile(this.fullPath);
            await this.parseProject(content);
            this.loaded = true;
        }
        if (!this.loadedPackages && this.hasReferences) {
            await this.parsePackages();
            this.loadedPackages = true;
        }
    }

    private async saveProject(): Promise<void> {
        if (!this.document) { return; }

        this.shouldReload = false;
        let content = await xml.parseToXml(this.document);
        await fs.writeFile(this.fullPath, content);
        await this.parseProject(content);
    }

    private async parseProject(content: string): Promise<void> {
        let document =  await xml.parseToJson(content);
        this.parseDocument(document);
    }

    private parseDocument(document: xml.XmlElement): void {
        if (!this.document) { return; }

        this.loaded = true;
        this.document = document;

        const project = StandardProject.getProjectElement(this.document);
        const nodeNames = this.getXmlNodeNames();
        const files: string[] = [];
        const folders: string[] = [];
        const dependents: { [id: string]: string[] } = {};
        const addFile = (ref: xml.XmlElement) => {
            let isDependent = false;
            if (ref.elements) {
                ref.elements.forEach((e: xml.XmlElement) => {
                    if (e.name === 'DependentUpon') {
                        isDependent = true;
                        let parent = e.elements[0].text;
                        if (!dependents[parent]) { dependents[parent] = []; }
                        dependents[parent].push(this.cleanIncludePath(ref.attributes.Include).replace(/\\/g, path.sep));
                    }
                });
            }

            if (!isDependent){
                files.push(this.cleanIncludePath(ref.attributes.Include).replace(/\\/g, path.sep));
            }
        };

        if (project) {
            project.elements.forEach((element: xml.XmlElement) => {
                if (element.name === 'ItemGroup') {
                    StandardProject.ensureElements(element);
                    element.elements.forEach((e: xml.XmlElement) => {
                        if (e.name === 'Reference' || e.name === 'ProjectReference') {
                            let include = this.cleanIncludePath(e.attributes.Include);
                            this.references.push(new ProjectReference(include, include));
                            return false;
                        }

                        if (e.name === 'Folder') {
                            addFile(e);
                            let folder = this.cleanIncludePath(e.attributes.Include).replace(/\\/g, path.sep);
                            if (folder.endsWith(path.sep)) {
                                folder = folder.substring(0, folder.length - 1);
                            }

                            folders.push(folder);
                            return false;
                        }

                        nodeNames.forEach(nodeName => {
                            if (e.name === nodeName) {
                                addFile(e);
                            }
                        });
                    });
                }
            });
        }

        this.filesTree = this.parseToTree(files);
        this.folders = folders;
        this.dependents = dependents;
    }

    private async parsePackages(): Promise<void> {
        this.packages = [];
        let packagesPath = path.join(path.dirname(this.fullPath), 'packages.config');
        if (!(await fs.exists(packagesPath))) { return; }

        let content = await fs.readFile(packagesPath);
        let packageRegEx = /<package\s+id=\"(.*)\"\s+version=\"(.*)\"\s+targetFramework=\"(.*)\"/g;
        let m: RegExpExecArray | null;
        while ((m = packageRegEx.exec(content)) !== null) {
            this.packages.push(new PackageReference(m[1].trim(), m[2].trim()));
        }
    }

    private parseToTree(files: string[]): TreePart[] {
        let tree: TreePart[] = [];
        files.forEach(filepath => {
            // Get absolute path of file
            filepath = filepath.replace(/\\/g, path.sep);
            filepath = path.resolve(path.dirname(this.fullPath), filepath);

            // Trim the leading path that the file and project file share
            let currentFullPath = commonPrefix(path.dirname(this.fullPath), filepath);
            let virtualPath = path.relative(currentFullPath, filepath);

            let pathParts = virtualPath.split(path.sep);
            let currentLevel = tree;
            pathParts.forEach(part => {
                if (!part) { return; }
                currentFullPath = path.join(currentFullPath, part);
                let existingPathIndex = currentLevel.findIndex(i => i.name === part);
                if (existingPathIndex >= 0) {
                    currentLevel = currentLevel[existingPathIndex].children;
                } else {
                    let newPart = {
                        name: part,
                        virtualpath: virtualPath,
                        fullpath: currentFullPath,
                        children: [],
                    };

                    currentLevel.push(newPart);
                    currentLevel = newPart.children;
                }
            });
        });

        return tree;
    }

    private countInNodes(pattern: string, isFolder: boolean = false): number {
        if (!this.document) { return 0; }

        pattern = pattern.replace(/\//g, '\\') + (isFolder ? '\\' : '');
        if (this.includePrefix) { pattern = this.includePrefix + pattern; }

        let counter = 0;
        const findPattern = (ref: xml.XmlElement) => {
            if (ref.attributes.Include.startsWith(pattern)) {
                counter++;
            }
        };

        const nodeNames = this.getXmlNodeNames();
        const project = StandardProject.getProjectElement(this.document);
        if (!project) { return 0; }

        project.elements.forEach((element: xml.XmlElement) => {
            if (element.name === 'ItemGroup') {
                if (!element.elements || !Array.isArray(element.elements)) {
                    element.elements = [];
                }

                element.elements.forEach((e: xml.XmlElement) => {
                    nodeNames.forEach(nodeName => {
                        if (e.name === nodeName) {
                            findPattern(e);
                        }
                    });
                });
            }
        });

        return counter;
    }

    private renameInNodes(pattern: string, newPattern: string, isFolder: boolean = false): void {
        if (!this.document) { return; }

        pattern = pattern.replace(/\//g, '\\') + (isFolder ? '\\' : '');
        newPattern = newPattern.replace(/\//g, '\\') + (isFolder ? '\\' : '');

        if (this.includePrefix) {
            pattern = this.includePrefix + pattern;
            newPattern = this.includePrefix + newPattern;
        }

        let findPattern = (ref: xml.XmlElement) => {
            this.replaceDependsUponNode(ref, pattern, newPattern);

            if (ref.attributes.Include.startsWith(pattern)) {
                ref.attributes.Include = ref.attributes.Include.replace(pattern, newPattern);
            }
        };

        let nodeNames = this.getXmlNodeNames();
        let project = StandardProject.getProjectElement(this.document);
        if (!project) { return; }

        project.elements.forEach((element: xml.XmlElement) => {
            if (element.name === 'ItemGroup') {
                if (!element.elements || !Array.isArray(element.elements)) {
                    element.elements = [];
                }

                element.elements.forEach((e: xml.XmlElement) => {
                    nodeNames.forEach(nodeName => {
                        if (e.name === nodeName) {
                            findPattern(e);
                        }
                    });
                });
            }
        });
    }

    protected replaceDependsUponNode(ref: xml.XmlElement, pattern: string, newPattern: string) {
        if (!ref.elements) { return; }

        ref.elements.forEach((e: xml.XmlElement) => {
            if (e.name === 'DependentUpon' && e.elements[0].text.startsWith(pattern)) {
                e.elements[0].text = e.elements[0].text.replace(pattern, newPattern);
            }
        });
    }

    private removeInNodes(pattern: string, isFolder: boolean = false, types: string[] | null = null): void {
        if (!this.document) { return; }

        pattern = pattern.replace(/\//g, '\\') + (isFolder ? '\\' : '');
        if (this.includePrefix) {
            pattern = this.includePrefix + pattern;
        }

        if (!types) {
            types = this.getXmlNodeNames();
        }

        const project = StandardProject.getProjectElement(this.document);
        if (!project) { return; }

        project.elements.forEach((element: xml.XmlElement, elementIndex: number) => {
            if (element.name === 'ItemGroup') {
                StandardProject.ensureElements(element);
                const toDelete: xml.XmlElement[] = [];
                element.elements.forEach((e: xml.XmlElement) => {
                    if (types === null) { return; }
                    types.forEach(nodeName => {
                        if (e.name === nodeName) {
                            this.deleteDependsUponNode(e, pattern);
                            if (e.attributes.Include.startsWith(pattern)) {
                                toDelete.push(e);
                            }
                        }
                    });
                });

                toDelete.forEach(e => {
                    element.elements.splice(element.elements.indexOf(e), 1);
                });


                if (element.elements.length === 0) {
                    project.elements.splice(elementIndex, 1);
                }
            }
        });
    }

    protected deleteDependsUponNode(node: xml.XmlElement, pattern: string) {
        if (!node.elements) { return; }

        node.elements.forEach((e: xml.XmlElement, eIndex: number) => {
            if (e.name === 'DependentUpon' && e.elements[0].text.startsWith(pattern)) {
                node.elements.splice(eIndex, 1);
            }
        });

        if (node.elements.length === 0) {
            delete node.elements;
        }
    }

    private currentItemGroupAdd(type: string, include: string, isFolder: boolean = false): void {
        this.checkCurrentItemGroup();
        if (!this.currentItemGroup) { return; }

        include = include.replace(/\//g, '\\') + (isFolder ? '\\' : '');

        if (this.includePrefix) {
            include = this.includePrefix + include;
        }

        this.currentItemGroup.elements.push({
            type: 'element',
            name: type,
            attributes: {
                ["Include"]: include
            }
        });
    }

    private checkCurrentItemGroup(): void {
        if (!this.document) { return; }

        const project = StandardProject.getProjectElement(this.document);
        if (!project) { return; }

        let current: xml.XmlElement | undefined;
        let lastElement: xml.XmlElement | undefined;
        project.elements.forEach((element: xml.XmlElement) => {
            if (element.name === 'ItemGroup') {
                lastElement = element;
            }
            if (this.currentItemGroup && element === this.currentItemGroup) {
                current = element;
            }
        });

        if (!current && !lastElement) {
            current = {
                type: 'element',
                name: 'ItemGroup',
                elements: []
            };
            project.elements.push(current);
        } else if (!current) {
            current = lastElement;
        }

        this.currentItemGroup = current;
    }

    private getRelativePath(fullpath: string): string {
        return path.relative(path.dirname(this.fullPath), fullpath);
    }

    private async getFoldersFromTree(items: TreePart[]): Promise<string[]> {
        if (!Array.isArray(items)) {
            return [];
        }

        let result: string[] = [];
        for (let i = 0; i < items.length; i++) {
            let item = items[i];
            let isDirectory = await fs.isDirectory(item.fullpath);
            if (isDirectory) {
                result.push(item.fullpath);
                let subItems = await this.getFoldersFromTree(item.children);
                subItems.forEach(si => result.push(si));
            }
        }

        return result;
    }

    private cleanIncludePath(include: string): string {
        if (this.includePrefix) {
            return include.replace(this.includePrefix, "");
        }

        return include;
    }

    private getXmlNodeNames(): string[] {
        let result: string[] = [
            "Compile",
            "ClCompile",
            "ClInclude",
            "Content",
            "TypeScriptCompile",
            "CustomBuild",
            "EmbeddedResource",
            "None",
            "Folder"
        ];
        let itemTypes = SolutionExplorerConfiguration.getItemTypes();
        Object.keys(itemTypes).forEach(key => {
            if (result.indexOf(itemTypes[key]) < 0) {
                result.push(itemTypes[key]);
            }
        });

        return result;
    }
}