import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function CreateAffaire() {
  return (
    <Dialog>
      <form>
        <DialogTrigger render={<Button variant="outline">Create</Button>} />

        <DialogContent className="lg:max-w-lg">

          <DialogHeader className="bg-amber-300">
            <DialogTitle>Créez une affaire</DialogTitle>
            {/* <DialogDescription>
              Make changes to your profile here. Click save when you&apos;re
              done.
            </DialogDescription> */}
          </DialogHeader>

          <FieldGroup className="bg-blue-300 flex gap-4">
            <Field className="flex-1 space-y-2">
              <Input id="numero-1" name="numero" placeholder="N° de commande" className="w-1/2"/>
              <Input id="client-1" name="client" placeholder="Nom du client" className="w-1/2"/>
            </Field>
            <Field className="bg-green-500">
              <Input id="Profil-1" name="Profil" placeholder="Profil" />
            </Field>
          </FieldGroup>

          <DialogFooter className="bg-red-300">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button type="submit">Create</Button>
          </DialogFooter>

        </DialogContent>
      </form>
    </Dialog>
  )
}
