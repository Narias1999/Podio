"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parse } from "date-fns";
import { es } from "date-fns/locale";
import { Bike, CalendarIcon, Footprints } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DefaultCategory } from "@/lib/default-categories";
import {
  type CreateRacePayload,
  type WizardCategory,
  isBasicInfoComplete,
} from "@/lib/race-wizard";
import type { Discipline, Sex } from "@/types/app";
import { CategoriesStep, makeCategory } from "@/app/races/new/categories-step";

const STEPS = [
  "Información básica",
  "Disciplina y formato",
  "Categorías",
  "Revisar y publicar",
] as const;

const ISO_DATE = "yyyy-MM-dd";

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const d = parse(iso, ISO_DATE, new Date());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dateToIso(date: Date | undefined): string {
  return date ? format(date, ISO_DATE) : "";
}

function formatHuman(iso: string): string {
  const d = isoToDate(iso);
  return d ? format(d, "PPP", { locale: es }) : "";
}

const SEX_LABELS: Record<Sex, string> = {
  male: "Masculino",
  female: "Femenino",
};

function sexLabel(sex: Sex | null): string {
  return sex ? SEX_LABELS[sex] : "Cualquiera";
}

function ageLabel(cat: WizardCategory): string {
  if (cat.age_min !== null && cat.age_max !== null) {
    return `${cat.age_min}–${cat.age_max} años`;
  }
  if (cat.age_min !== null) return `${cat.age_min}+ años`;
  if (cat.age_max !== null) return `hasta ${cat.age_max} años`;
  return "sin rango de edad";
}

type DateFieldProps = {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  placeholder: string;
  fromDate?: Date;
};

function DateField({ id, value, onChange, placeholder, fromDate }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 size-4" />
          {selected ? formatHuman(value) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={es}
          selected={selected}
          defaultMonth={selected ?? fromDate}
          disabled={fromDate ? { before: fromDate } : undefined}
          onSelect={(d) => {
            onChange(dateToIso(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

type DisciplineFormat = boolean; // is_multi_stage

export function RaceWizard({
  defaultCategories,
}: {
  defaultCategories: readonly DefaultCategory[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [description, setDescription] = useState("");

  // Step 2
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [isMultiStage, setIsMultiStage] = useState<DisciplineFormat | null>(
    null,
  );

  // Step 3
  const [categories, setCategories] = useState<WizardCategory[]>(() =>
    defaultCategories.map(makeCategory),
  );

  const canProceedStep1 = useMemo(
    () => isBasicInfoComplete({ name, location, starts_at: startsAt }),
    [name, location, startsAt],
  );

  function goNext() {
    setStepError(null);
    if (step === 0) {
      if (!canProceedStep1) {
        setStepError("Completa el nombre, la ubicación y la fecha de inicio.");
        return;
      }
      if (endsAt && endsAt < startsAt) {
        setStepError(
          "La fecha de finalización no puede ser anterior a la de inicio.",
        );
        return;
      }
    }
    if (step === 1) {
      if (discipline === null || isMultiStage === null) {
        setStepError("Selecciona una disciplina y un formato.");
        return;
      }
    }
    if (step === 2) {
      if (categories.length === 0) {
        setStepError("Agrega al menos una categoría.");
        return;
      }
      if (categories.some((c) => !c.name.trim())) {
        setStepError("Cada categoría debe tener un nombre.");
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  function submit(status: "draft" | "published") {
    setSubmitError(null);
    if (discipline === null || isMultiStage === null) {
      setSubmitError("Faltan datos de disciplina o formato.");
      return;
    }
    const payload: CreateRacePayload = {
      name: name.trim(),
      location: location.trim(),
      starts_at: startsAt,
      ends_at: endsAt || null,
      description: description.trim() || null,
      banner_url: null,
      discipline,
      is_multi_stage: isMultiStage,
      status,
      categories: categories.map((c) => ({
        name: c.name.trim(),
        age_min: c.age_min,
        age_max: c.age_max,
        sex: c.sex,
      })),
    };

    startTransition(async () => {
      try {
        const res = await fetch("/api/races", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { slug?: string; error?: string };
        if (!res.ok || !data.slug) {
          setSubmitError(
            data.error ?? "No se pudo crear la carrera. Inténtalo de nuevo.",
          );
          return;
        }
        router.push(`/races/${data.slug}/manage`);
      } catch {
        setSubmitError("No se pudo crear la carrera. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crear carrera</CardTitle>
        <CardDescription>
          Paso {step + 1} de {STEPS.length}: {STEPS[step]}
        </CardDescription>
        <Stepper current={step} />
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <Field
              label="Nombre de la carrera"
              htmlFor="name"
              required
            >
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Vuelta a Colombia 2026"
              />
            </Field>
            <Field label="Ubicación" htmlFor="location" required>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ej: Bogotá, Colombia"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fecha de inicio" htmlFor="starts-at" required>
                <DateField
                  id="starts-at"
                  value={startsAt}
                  onChange={setStartsAt}
                  placeholder="Selecciona una fecha"
                />
              </Field>
              <Field label="Fecha de finalización" htmlFor="ends-at">
                <DateField
                  id="ends-at"
                  value={endsAt}
                  onChange={setEndsAt}
                  placeholder="Opcional (evento de un día)"
                  fromDate={isoToDate(startsAt)}
                />
              </Field>
            </div>
            <Field label="Descripción" htmlFor="description">
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe la carrera (opcional)"
                rows={4}
              />
            </Field>
            <Field label="Imagen del banner" htmlFor="banner">
              <Input id="banner" type="file" accept="image/*" disabled />
              <p className="text-xs text-muted-foreground">
                La carga de imágenes estará disponible pronto.
              </p>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Label>Disciplina</Label>
              <div className="grid grid-cols-2 gap-3">
                <ToggleCard
                  active={discipline === "cycling"}
                  onClick={() => setDiscipline("cycling")}
                  icon={<Bike className="size-7" />}
                  label="Ciclismo"
                />
                <ToggleCard
                  active={discipline === "running"}
                  onClick={() => setDiscipline("running")}
                  icon={<Footprints className="size-7" />}
                  label="Atletismo"
                />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Formato</Label>
              <div className="grid grid-cols-2 gap-3">
                <ToggleCard
                  active={isMultiStage === false}
                  onClick={() => setIsMultiStage(false)}
                  label="Etapa única"
                />
                <ToggleCard
                  active={isMultiStage === true}
                  onClick={() => setIsMultiStage(true)}
                  label="Por etapas"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Las carreras por etapas permiten registrar resultados a lo largo
                de varios días y mostrar una Clasificación General (GC).
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <CategoriesStep
            categories={categories}
            onChange={setCategories}
            presets={defaultCategories}
            error={stepError ?? undefined}
          />
        )}

        {step === 3 && (
          <ReviewStep
            name={name}
            location={location}
            startsAt={startsAt}
            endsAt={endsAt}
            description={description}
            discipline={discipline}
            isMultiStage={isMultiStage}
            categories={categories}
          />
        )}

        {stepError && step !== 2 && (
          <p className="text-sm text-destructive" role="alert">
            {stepError}
          </p>
        )}
        {submitError && (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            disabled={step === 0 || pending}
          >
            Atrás
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={goNext}>
              Siguiente
            </Button>
          ) : (
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={() => submit("published")}
                disabled={pending}
              >
                {pending ? "Guardando..." : "Publicar carrera"}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="mt-2 flex gap-2" aria-hidden>
      {STEPS.map((label, i) => (
        <div
          key={label}
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors",
            i <= current ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function ToggleCard({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 text-base font-medium transition-colors",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ReviewStep({
  name,
  location,
  startsAt,
  endsAt,
  description,
  discipline,
  isMultiStage,
  categories,
}: {
  name: string;
  location: string;
  startsAt: string;
  endsAt: string;
  description: string;
  discipline: Discipline | null;
  isMultiStage: boolean | null;
  categories: WizardCategory[];
}) {
  const dates = endsAt
    ? `${formatHuman(startsAt)} – ${formatHuman(endsAt)}`
    : formatHuman(startsAt);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <SummaryItem label="Nombre" value={name || "—"} />
        <SummaryItem label="Ubicación" value={location || "—"} />
        <SummaryItem label="Fechas" value={dates || "—"} />
        <SummaryItem
          label="Disciplina"
          value={
            discipline === "cycling"
              ? "Ciclismo"
              : discipline === "running"
                ? "Atletismo"
                : "—"
          }
        />
        <SummaryItem
          label="Formato"
          value={
            isMultiStage === null
              ? "—"
              : isMultiStage
                ? "Por etapas"
                : "Etapa única"
          }
        />
      </dl>

      {description.trim() && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Descripción
          </p>
          <p className="text-sm whitespace-pre-wrap">{description.trim()}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Categorías ({categories.length})
        </p>
        <ol className="flex flex-col gap-1">
          {categories.map((cat, i) => (
            <li
              key={cat.key}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{i + 1}.</span>
              <span className="font-medium">{cat.name || "(sin nombre)"}</span>
              <Badge variant="secondary">{sexLabel(cat.sex)}</Badge>
              <Badge variant="outline">{ageLabel(cat)}</Badge>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
