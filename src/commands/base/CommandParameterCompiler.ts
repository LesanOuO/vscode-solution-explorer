import { ICommandParameter } from "./ICommandParameter";

type Resolver = (value?: string[] | PromiseLike<string[]>) => void;

export class CommandParameterCompiler {
    private currentStep: number = 0;
    private resolver: Resolver | undefined;
    private result: string[] = [];

    constructor(public readonly title: string, private parameters: ICommandParameter[]) {
    }

    public get steps(): number {
        let numberOfSteps = 0;
        this.parameters.forEach(p => { numberOfSteps += p.shouldAskUser ? 1 : 0; } );
        return numberOfSteps;
    }

    public get step(): number {
        let virtualStep = 0;
        this.parameters.forEach((p, index) => { virtualStep += index <= this.currentStep && p.shouldAskUser ? 1 : 0; } );
        return virtualStep;
    }

    public get results(): string[] {
        this.refreshResult();
        return this.result;
    }

    private get currentCommandParameter(): ICommandParameter {
        return this.parameters[this.currentStep];
    }

    public next(): void {
        if (!this.resolver) { return; }
        if (this.currentStep + 1 < this.parameters.length) {
            this.currentStep++;
            this.currentCommandParameter.setArguments(this);
            if (!this.currentCommandParameter.shouldAskUser) {
                this.next();
            }
        } else {
            this.onCompleted();
        }
    }

    public prev(): void {
        if (!this.resolver) { return; }
        if (this.currentStep - 1 <= 0) {
            this.currentStep--;
            this.currentCommandParameter.setArguments(this);
            if (!this.currentCommandParameter.shouldAskUser) {
                this.prev();
            }
        }
    }

    public cancel(): void {
        this.onCancel();
    }

    public compile(): Promise<string[] | undefined> {
        return new Promise(resolve => {
            this.resolver = resolve;
            this.currentStep = -1;
            this.next();
        });
    }

    private onCompleted(): void {
        if (this.resolver) {
            this.refreshResult();
            this.resolver(this.result);
            this.resolver = undefined;
        }
    }

    private onCancel(): void {
        if (this.resolver) {
            this.resolver(undefined);
            this.resolver = undefined;
        }
    }

    private refreshResult(): void {
        this.result = [];
        this.parameters.forEach(p => { this.result = this.result.concat(p.getArguments()); });
    }
}