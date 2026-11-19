// Coastlines and country shapes (Natural Earth 1:50m via world-atlas), bundled locally.
import { geoContains } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';

export const LAND = feature(world, world.objects.land);
export const COUNTRIES = feature(world, world.objects.countries);
export const BORDERS = mesh(world, world.objects.countries, (a, b) => a !== b);

export const isLand = (p) => geoContains(LAND, [p.lon, p.lat]);

export function countryAt(p) {
  for (const f of COUNTRIES.features) {
    if (geoContains(f, [p.lon, p.lat])) return f.properties.name;
  }
  return null;
}
