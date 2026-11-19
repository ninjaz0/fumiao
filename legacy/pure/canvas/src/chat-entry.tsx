import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {ChatWorkspace} from './chat/ChatWorkspace';
let root:Root|null=null;
export function mount(element:HTMLElement,options:{workspace:number;userId:number}){unmount();root=createRoot(element);root.render(<ChatWorkspace {...options}/>)}
export function unmount(){root?.unmount();root=null}

import {AssetPacks,type AssetPacksProps} from './AssetPacks';
let packsRoot:Root|null=null;
export function mountPacks(element:HTMLElement,options:AssetPacksProps){unmountPacks();packsRoot=createRoot(element);packsRoot.render(<AssetPacks {...options}/>)}
export function unmountPacks(){packsRoot?.unmount();packsRoot=null}
