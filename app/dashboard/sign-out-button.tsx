import { Button } from "@/components/ui/button";
import { signOut } from "@/app/dashboard/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline">
        Cerrar sesión
      </Button>
    </form>
  );
}
