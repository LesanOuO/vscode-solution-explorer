import { SolutionExplorerProvider } from "@SolutionExplorerProvider";
import { TreeItem, ContextValues } from "@tree";
import { CommandBase } from "@commands/base";
import { InputTextCommandParameter } from "@commands/parameters/InputTextCommandParameter";

export class RenameCommand extends CommandBase {

    constructor(private readonly provider: SolutionExplorerProvider) {
        super('Rename');
    }

    protected shouldRun(item: TreeItem): boolean {
        this.parameters = [
            new InputTextCommandParameter('New name', item.label, undefined, item.label)
        ];

        return !!item.project;
    }

    protected async runCommand(item: TreeItem, args: string[]): Promise<void> {
        if (!args || args.length <= 0 || !item || !item.project || !item.path) { return; }

        try {
            if (item.contextValue.startsWith(ContextValues.projectFile)) {
                await item.project.renameFile(item.path, args[0]);
            } else if (item.contextValue.startsWith(ContextValues.projectFolder)) {
                await item.project.renameFolder(item.path, args[0]);
            } else {
                return;
            }

            this.provider.logger.log("Renamed: " + item.path + " -> " + args[0]);
        } catch(ex) {
            this.provider.logger.error('Can not rename item: ' + ex);
        }
    }
}
