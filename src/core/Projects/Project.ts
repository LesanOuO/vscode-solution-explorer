import { ProjectInSolution } from "../Solutions";
import { ProjectFile } from "./ProjectFile";
import { ProjectFolder } from "./ProjectFolder";
import { PackageReference } from "./PackageReference";
import { ProjectReference } from "./ProjectReference";
import { XmlElement } from "@extensions/xml";

export type ProjectFileStat = { exists: boolean, filename: string, fullpath: string };

export abstract class Project {
    private _hasReferences: boolean = true;

    constructor(protected readonly projectInSolution: ProjectInSolution, public readonly type: string) {
    }

    public fileExtension: string = '';

    public get name(): string {
        return this.projectInSolution.projectName;
    }

    public get fullPath(): string {
        return this.projectInSolution.fullPath;
    }

    public get hasReferences(): boolean {
        return this._hasReferences;
    }

    protected setHasReferences(value: boolean) {
        this._hasReferences = value;
    }

    public get solutionItems(): { [id: string]: string } {
        return this.projectInSolution.solutionItems;
    }

    public abstract getProjectReferences() : Promise<ProjectReference[]>;

    public abstract getPackageReferences() : Promise<PackageReference[]>;

    public abstract getProjectFilesAndFolders(virtualPath?: string): Promise<{ files: ProjectFile[], folders: ProjectFolder[] }>;

    public abstract renameFile(filepath: string, name: string): Promise<string>;

    public abstract deleteFile(filepath: string): Promise<void>;

    public abstract createFile(folderpath: string, filename: string, content?: string): Promise<string>;

    public abstract renameFolder(folderpath: string, name: string): Promise<string>;

    public abstract deleteFolder(folderpath: string): Promise<void>;

    public abstract createFolder(folderpath: string): Promise<string>;

    public abstract getFolderList(): Promise<string[]>;

    public abstract statFile(filepath: string, folderPath: string): Promise<ProjectFileStat>;

    public abstract moveFile(filepath: string, newfolderPath: string): Promise<string>;

    public abstract moveFolder(folderpath: string, newfolderPath: string): Promise<string>;

    public abstract refresh(): Promise<void>;

    public static getProjectElement(document: XmlElement): XmlElement | undefined {
        if (document && document.elements) {
            if (document.elements.length === 1) {
                return Project.ensureElements(document.elements[0]);
            } else {
                for(let i = 0; i < document.elements.length; i++) {
                    if (document.elements[i].type !== 'comment') {
                        return Project.ensureElements(document.elements[i]);
                    }
                }
            }
        }
    }

    public static ensureElements(element: XmlElement): XmlElement {
        if (!element.elements || !Array.isArray(element.elements)) {
            element.elements = [];
        }

        return element;
    }
}