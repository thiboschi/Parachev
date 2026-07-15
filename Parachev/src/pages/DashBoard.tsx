import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { EllipsisIcon } from "lucide-react";

import "./DashBoard.css"

export default function DashBoard() {
return (
  <div>
    <div className="header">
        <div className="flex items-center justify-between gap-1">
            <div>
                <Input placeholder="hello there" className="w-100"/>
                <Button variant="default" size="icon">
                    <EllipsisIcon />
                </Button>
                <Button variant="default">Search</Button>
            </div>
            <div>
                <ButtonGroup className="">
                    <Button variant="outline">Import</Button>
                    <Button variant="outline">Create</Button>
                </ButtonGroup>
            </div>
        </div>
        
    </div>
    <div className="page">

    </div>
  </div>
);
}