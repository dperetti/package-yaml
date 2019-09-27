import yaml from 'yaml';

declare module 'yaml' {
    namespace ast {
        type PathKey = string|number;
        interface Collection {
            getIn(path: PathKey[], keepScalar:true): any;
            getIn(path: PathKey[], keepScalar?:boolean): AstNode | undefined;
            setIn(path: PathKey[], value: any): void;
            deleteIn(path: PathKey[]): boolean;
            get(key:PathKey, keepScalar:true): any;
            get(key:PathKey, keepScalar?:boolean): AstNode | undefined;
            set(key:PathKey, value:any): void;
            delete(key:PathKey): boolean;
        }

        interface Document extends Collection {
            // Not strictly true but good enough for our purposes
        }

        interface MapBase extends Collection {

        }

        interface SeqBase extends Collection {

        }
    }
}